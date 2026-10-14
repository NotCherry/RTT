import asyncio
import base64
from fastapi import APIRouter, HTTPException
from .camera_gateway import CameraGateway, configured_sources

router = APIRouter(prefix="/api/camera-gateway", tags=["camera gateway"])
gateway = CameraGateway()


@router.get("/sources")
async def sources():
    try:
        return {"sources": [{"id": identity, "name": source.get("name", identity)} for identity, source in configured_sources().items()]}
    except ValueError as error:
        raise HTTPException(503, str(error)) from error


@router.get("/sources/{identity}/frame")
async def frame(identity: str):
    try:
        packet = await asyncio.to_thread(gateway.snapshot, identity)
        return {**packet, "jpeg": base64.b64encode(packet["jpeg"]).decode("ascii")}
    except KeyError as error:
        raise HTTPException(404, "Camera source is not configured") from error
    except (ValueError, RuntimeError, TimeoutError) as error:
        raise HTTPException(503, str(error)) from error


@router.on_event("shutdown")
async def close_gateway():
    await asyncio.to_thread(gateway.close)
