"""Robot control routes. Physical publication requires an explicit arm action."""
import asyncio
import json
import logging
import time
import anyio
from fastapi import APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from .robot_controller import RobotController
from .robot_transport_contract import ConnectionConfig, DDSConnectionPlan, TargetPacket
from .robot_motion import camera_joint_contract

controller = RobotController()
logger = logging.getLogger(__name__)


def create_transport_router(runtime):
    routes = APIRouter(prefix="/api/robot-transport", tags=["robot-transport"])

    def call(operation, *args):
        try:
            return operation(*args)
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc

    @routes.post("/plan")
    def plan_connection(plan: DDSConnectionPlan):
        return {"config": plan.model_dump(), "transmission_enabled": False,
            "command_topic": "rt/arm_sdk" if plan.transport == "unitree-sdk2" else "arm_sdk",
            "state_topic": "rt/lowstate" if plan.transport == "unitree-sdk2" else "lowstate",
            "command_type": "unitree_hg/LowCmd", "requires_robot_ip": False,
            "required_before_activation": ["isolated DDS network and verified robot model",
                "fresh measured state", "explicit operator arm action"]}

    @routes.get("/status")
    def status():
        return runtime.status()

    @routes.get("/diagnostics")
    def diagnostics():
        return runtime.diagnostics()

    @routes.post("/connect")
    def connect(config: ConnectionConfig):
        token = call(runtime.connect, config)
        return {**runtime.status(), "token": token, "joint_contract": camera_joint_contract(config)}

    @routes.post("/arm")
    def arm(x_robot_token: str | None = Header(default=None)):
        call(runtime.arm, x_robot_token)
        return runtime.status()

    @routes.post("/disarm")
    def disarm(x_robot_token: str | None = Header(default=None)):
        call(runtime.disarm, x_robot_token)
        return runtime.status()

    @routes.post("/disconnect")
    def disconnect(x_robot_token: str | None = Header(default=None)):
        # None is reserved for process shutdown, never an unauthenticated HTTP call.
        call(runtime.authorize, x_robot_token)
        call(runtime.disconnect, x_robot_token)
        return runtime.status()

    @routes.websocket("/stream")
    async def stream(socket: WebSocket):
        await socket.accept()
        owner = None
        try:
            credentials = await asyncio.wait_for(socket.receive_json(), timeout=5)
            token = credentials.get("token") if isinstance(credentials, dict) else None
            if not isinstance(token, str) or len(token) > 128:
                raise PermissionError("Invalid controller token")
            # Preserve the owner id if cancellation arrives during attachment.
            with anyio.CancelScope(shield=True):
                owner = await anyio.to_thread.run_sync(runtime.attach_stream, token)
            await socket.send_json({"ready": True, "server_time_ms": time.time() * 1000})
            while True:
                raw = await socket.receive_text()
                if len(raw) > 4096:
                    raise ValueError("Target packet is too large")
                packet = TargetPacket.model_validate_json(raw)
                await asyncio.to_thread(runtime.receive, owner, packet)
        except WebSocketDisconnect:
            pass
        except (PermissionError, ValueError, ValidationError, asyncio.TimeoutError, json.JSONDecodeError) as exc:
            logger.warning("Robot target stream rejected: %s", exc)
            if owner:
                await asyncio.to_thread(runtime.record_stream_error, str(exc))
            try:
                await socket.send_json({"error": str(exc)})
                await socket.close(code=1008)
            except RuntimeError:
                pass
        finally:
            # Browser/task cancellation must not interrupt disarming and cleanup.
            with anyio.CancelScope(shield=True):
                if owner and await anyio.to_thread.run_sync(runtime.detach_stream, owner):
                    try:
                        await anyio.to_thread.run_sync(runtime.disconnect, token)
                    except PermissionError:
                        pass

    return routes


router = create_transport_router(controller)
