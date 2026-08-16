from __future__ import annotations

import asyncio
import io
import json
import math
import threading
import uuid
import zipfile
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET

import numpy as np
import pybullet as p  # type: ignore[import-not-found]
import torch  # type: ignore[import-not-found]
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect  # type: ignore[import-not-found]
from fastapi.middleware.cors import CORSMiddleware  # type: ignore[import-not-found]
from fastapi.responses import StreamingResponse  # type: ignore[import-not-found]
from pydantic import BaseModel, Field  # type: ignore[import-not-found]

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_JOINTS = 32
MAX_DEMONSTRATIONS = 2000
MAX_EPOCHS = 5000

app = FastAPI(title="Robot Learning Workbench", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROBOTS: dict[str, dict[str, Any]] = {}
SESSIONS: dict[str, "SimulationSession"] = {}

DEMO_URDF = """<?xml version="1.0"?>
<robot name="slider-arm">
  <link name="base">
    <visual><geometry><box size="0.8 0.8 0.25"/></geometry><origin xyz="0 0 0"/></visual>
  </link>
  <link name="shoulder">
    <visual><geometry><cylinder radius="0.18" length="1.2"/></geometry><origin xyz="0 0 0.6" rpy="0 0 0"/></visual>
  </link>
  <link name="forearm">
    <visual><geometry><box size="0.28 0.28 1.0"/></geometry><origin xyz="0 0 0.5"/></visual>
  </link>
  <joint name="shoulder_joint" type="revolute">
    <parent link="base"/><child link="shoulder"/>
    <origin xyz="0 0 0.15"/><axis xyz="0 1 0"/>
    <limit lower="-1.57" upper="1.57" effort="20" velocity="2"/>
  </joint>
  <joint name="elbow_joint" type="revolute">
    <parent link="shoulder"/><child link="forearm"/>
    <origin xyz="0 0 1.2"/><axis xyz="0 1 0"/>
    <limit lower="-2.2" upper="2.2" effort="20" velocity="2"/>
  </joint>
</robot>"""


def floats(value: str | None, fallback: list[float]) -> list[float]:
    if not value:
        return fallback.copy()
    try:
        return [float(item) for item in value.split()]
    except (TypeError, ValueError):
        return fallback.copy()


def number(value: str | None, fallback: float) -> float:
    try:
        return float(value) if value is not None else fallback
    except (TypeError, ValueError):
        return fallback


def origin(element: ET.Element | None) -> dict[str, list[float]]:
    if element is None:
        return {"xyz": [0.0, 0.0, 0.0], "rpy": [0.0, 0.0, 0.0]}
    return {"xyz": floats(element.attrib.get("xyz"), [0.0, 0.0, 0.0]), "rpy": floats(element.attrib.get("rpy"), [0.0, 0.0, 0.0])}


def parse_geometry(geometry: ET.Element, link_name: str) -> dict[str, Any]:
    mesh = geometry.find("mesh")
    if mesh is not None:
        raise ValueError(f"Link '{link_name}' references mesh '{mesh.attrib.get('filename', 'unknown')}'. Mesh assets are not supported in this MVP.")
    box = geometry.find("box")
    if box is not None:
        return {"type": "box", "size": floats(box.attrib.get("size"), [0.2, 0.2, 0.2])}
    cylinder = geometry.find("cylinder")
    if cylinder is not None:
        return {"type": "cylinder", "radius": number(cylinder.attrib.get("radius"), 0.1), "length": number(cylinder.attrib.get("length"), 0.3)}
    sphere = geometry.find("sphere")
    if sphere is not None:
        return {"type": "sphere", "radius": number(sphere.attrib.get("radius"), 0.1)}
    raise ValueError(f"Link '{link_name}' has unsupported or missing geometry. Use box, cylinder, or sphere.")


def parse_urdf(raw: bytes, filename: str, stored_path: Path) -> dict[str, Any]:
    try:
        xml_root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ValueError(f"Invalid URDF XML: {exc}") from exc
    if xml_root.tag != "robot":
        raise ValueError("The uploaded XML does not contain a <robot> root element.")

    links: list[dict[str, Any]] = []
    link_names: set[str] = set()
    for link in xml_root.findall("link"):
        name = link.attrib.get("name")
        if not name:
            raise ValueError("Every link must have a name.")
        link_names.add(name)
        visuals: list[dict[str, Any]] = []
        for visual in link.findall("visual"):
            geometry_element = visual.find("geometry")
            if geometry_element is None:
                continue
            geometry = parse_geometry(geometry_element, name)
            material = visual.find("material")
            color = [0.28, 0.62, 0.91, 1.0]
            color_element = material.find("color") if material is not None else None
            if color_element is not None:
                color = floats(color_element.attrib.get("rgba"), color)
                if len(color) == 3:
                    color.append(1.0)
            visuals.append({"geometry": geometry, "origin": origin(visual.find("origin")), "color": color})
        links.append({"name": name, "visuals": visuals})

    joints: list[dict[str, Any]] = []
    child_names: set[str] = set()
    for joint in xml_root.findall("joint"):
        name = joint.attrib.get("name")
        joint_type = joint.attrib.get("type", "fixed")
        parent = joint.find("parent")
        child = joint.find("child")
        if not name or parent is None or child is None:
            raise ValueError("Every joint needs a name, parent link, and child link.")
        parent_name = parent.attrib.get("link", "")
        child_name = child.attrib.get("link", "")
        if parent_name not in link_names or child_name not in link_names:
            raise ValueError(f"Joint '{name}' references an unknown link.")
        child_names.add(child_name)
        axis_element = joint.find("axis")
        axis = floats(axis_element.attrib.get("xyz") if axis_element is not None else None, [0.0, 0.0, 1.0])
        limit = joint.find("limit")
        if joint_type == "continuous":
            lower, upper = -math.pi, math.pi
        else:
            lower = number(limit.attrib.get("lower") if limit is not None else None, -math.pi)
            upper = number(limit.attrib.get("upper") if limit is not None else None, math.pi)
        if joint_type == "prismatic" and limit is None:
            lower, upper = -1.0, 1.0
        joints.append({
            "name": name,
            "type": joint_type,
            "parent": parent_name,
            "child": child_name,
            "origin": origin(joint.find("origin")),
            "axis": axis,
            "lower": lower,
            "upper": upper,
            "controllable": joint_type in {"revolute", "continuous", "prismatic"},
        })

    if not links:
        raise ValueError("The URDF does not contain any links.")
    if len(joints) > MAX_JOINTS:
        raise ValueError(f"This MVP supports at most {MAX_JOINTS} joints.")
    roots = link_names - child_names
    root_link = sorted(roots)[0] if roots else links[0]["name"]
    return {
        "id": stored_path.parent.name,
        "name": xml_root.attrib.get("name", Path(filename).stem),
        "filename": filename,
        "path": str(stored_path),
        "root": root_link,
        "links": links,
        "joints": joints,
    }


def serializable_robot(robot: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in robot.items() if key != "path"}


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


class TrainConfig(BaseModel):
    hidden_layers: list[int] = Field(default_factory=lambda: [64, 64])
    activation: str = "relu"
    learning_rate: float = Field(0.003, gt=0.000001, le=1.0)
    epochs: int = Field(300, ge=1, le=MAX_EPOCHS)
    batch_size: int = Field(16, ge=1, le=256)


class DemonstrationFrame(BaseModel):
    timestamp: float = Field(ge=0)
    positions: list[float]


class Demonstration(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    name: str = "Untitled pose"
    kind: str = "pose"
    current: list[float]
    target: list[float]
    frames: list[DemonstrationFrame] = Field(default_factory=list)


class DemonstrationsRequest(BaseModel):
    demonstrations: list[Demonstration]


class TrainRequest(BaseModel):
    demonstrations: list[Demonstration]
    config: TrainConfig = Field(default_factory=TrainConfig)


class SessionRequest(BaseModel):
    robot_id: str


class PredictRequest(BaseModel):
    target: list[float]
    current: list[float] | None = None


class SimulationSession:
    def __init__(self, session_id: str, robot: dict[str, Any]):
        self.id = session_id
        self.robot = robot
        self.lock = threading.Lock()
        self.events: list[dict[str, Any]] = []
        self.training = False
        self.model: torch.nn.Module | None = None
        self.model_config: dict[str, Any] | None = None
        self.demonstrations: list[dict[str, Any]] = []
        self.client = p.connect(p.DIRECT)
        p.setGravity(0, 0, -9.81, physicsClientId=self.client)
        self.body: int | None = None
        try:
            self.body = p.loadURDF(robot["path"], useFixedBase=True, physicsClientId=self.client)
        except Exception as exc:
            self.events.append({"type": "warning", "message": f"PyBullet could not load the URDF; using kinematic preview: {exc}"})
        self.joints = [joint for joint in robot["joints"] if joint["controllable"]]
        self.positions = [0.0 for _ in self.joints]
        self.pybullet_indices: list[int] = []
        if self.body is not None:
            for index in range(p.getNumJoints(self.body, physicsClientId=self.client)):
                info = p.getJointInfo(self.body, index, physicsClientId=self.client)
                joint_name = info[1].decode("utf-8")
                match = next((i for i, joint in enumerate(self.joints) if joint["name"] == joint_name), None)
                if match is not None:
                    self.pybullet_indices.append(index)
            self._apply_positions()

    def _apply_positions(self) -> None:
        if self.body is None:
            return
        for position, index in zip(self.positions, self.pybullet_indices):
            p.resetJointState(self.body, index, position, physicsClientId=self.client)

    def set_positions(self, values: list[float]) -> None:
        if len(values) != len(self.joints):
            raise ValueError("The number of joint positions does not match the robot.")
        try:
            self.positions = [clamp(float(value), joint["lower"], joint["upper"]) for value, joint in zip(values, self.joints)]
        except (TypeError, ValueError) as exc:
            raise ValueError("Joint positions must be numeric.") from exc
        self._apply_positions()

    def step(self) -> None:
        if self.body is not None:
            p.stepSimulation(physicsClientId=self.client)
            values = []
            for index, joint in zip(self.pybullet_indices, self.joints):
                try:
                    values.append(float(p.getJointState(self.body, index, physicsClientId=self.client)[0]))
                except (TypeError, ValueError, IndexError):
                    values.append(self.positions[len(values)])
            if values:
                self.positions = values

    def state(self) -> dict[str, Any]:
        return {"type": "state", "positions": self.positions, "training": self.training}

    def close(self) -> None:
        if p.isConnected(self.client):
            p.disconnect(self.client)


def normalized(values: list[float], joints: list[dict[str, Any]]) -> list[float]:
    result = []
    for value, joint in zip(values, joints):
        span = max(joint["upper"] - joint["lower"], 1e-6)
        result.append(2.0 * (value - joint["lower"]) / span - 1.0)
    return result


def denormalized(values: list[float], joints: list[dict[str, Any]]) -> list[float]:
    result = []
    for value, joint in zip(values, joints):
        span = joint["upper"] - joint["lower"]
        result.append(clamp((value + 1.0) * 0.5 * span + joint["lower"], joint["lower"], joint["upper"]))
    return result


def make_model(input_size: int, output_size: int, config: TrainConfig) -> torch.nn.Module:
    layers: list[torch.nn.Module] = []
    size = input_size
    activation: type[torch.nn.Module] = {"relu": torch.nn.ReLU, "tanh": torch.nn.Tanh, "gelu": torch.nn.GELU}.get(config.activation, torch.nn.ReLU)
    for hidden_size in config.hidden_layers:
        if hidden_size < 1 or hidden_size > 512:
            raise ValueError("Hidden layer sizes must be between 1 and 512.")
        layers.extend([torch.nn.Linear(size, hidden_size), activation()])
        size = hidden_size
    layers.append(torch.nn.Linear(size, output_size))
    return torch.nn.Sequential(*layers)


def train_session(session: SimulationSession, request: TrainRequest) -> None:
    try:
        if not request.demonstrations:
            raise ValueError("Capture at least one demonstration before training.")
        joint_count = len(session.joints)
        if any(len(item.current) != joint_count or len(item.target) != joint_count for item in request.demonstrations):
            raise ValueError("Each demonstration must contain one value per controllable joint.")
        torch.manual_seed(7)
        inputs = [normalized(item.current, session.joints) + normalized(item.target, session.joints) for item in request.demonstrations]
        targets = [normalized(item.target, session.joints) for item in request.demonstrations]
        x = torch.tensor(inputs, dtype=torch.float32)
        y = torch.tensor(targets, dtype=torch.float32)
        model = make_model(joint_count * 2, joint_count, request.config)
        optimizer = torch.optim.Adam(model.parameters(), lr=request.config.learning_rate)
        loss_function = torch.nn.SmoothL1Loss()
        steps = request.config.epochs
        loss = torch.tensor(float("nan"))
        for epoch in range(steps):
            prediction = model(x)
            loss = loss_function(prediction, y)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            if epoch == 0 or (epoch + 1) % max(1, steps // 20) == 0 or epoch == steps - 1:
                session.events.append({"type": "training", "epoch": epoch + 1, "epochs": steps, "loss": float(loss.item())})
        with session.lock:
            session.model = model.eval()
            session.model_config = request.config.model_dump()
            session.demonstrations = [item.model_dump() for item in request.demonstrations]
            session.events.append({"type": "training_complete", "loss": float(loss.item()), "demonstrations": len(request.demonstrations)})
    except Exception as exc:
        session.events.append({"type": "error", "message": str(exc)})
    finally:
        session.training = False


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def robot_file_path(robot_id: str) -> Path:
    if not robot_id or any(not (character.isalnum() or character == "-") for character in robot_id):
        raise ValueError("Invalid robot storage identifier.")
    data_root = DATA_DIR.resolve()
    robot_dir = (data_root / robot_id).resolve()
    if data_root not in robot_dir.parents:
        raise ValueError("Robot storage path escaped the data directory.")
    robot_dir.mkdir(parents=True, exist_ok=True)
    return robot_dir / "robot.urdf"


@app.post("/api/robots/parse")
async def upload_robot(file: UploadFile = File(...)) -> dict[str, Any]:
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"URDF upload exceeds the {MAX_UPLOAD_BYTES // 1024 // 1024} MB limit.")
    robot_id = uuid.uuid4().hex
    path = robot_file_path(robot_id)
    try:
        robot = parse_urdf(raw, file.filename or "robot.urdf", path)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    path.write_bytes(raw)
    ROBOTS[robot_id] = robot
    return serializable_robot(robot)


@app.get("/api/robots/demo")
def demo_robot() -> dict[str, Any]:
    robot_id = "demo-slider-arm"
    if robot_id not in ROBOTS:
        path = robot_file_path(robot_id)
        path.write_text(DEMO_URDF)
        ROBOTS[robot_id] = parse_urdf(DEMO_URDF.encode(), "slider-arm.urdf", path)
    return serializable_robot(ROBOTS[robot_id])


@app.post("/api/sessions")
def create_session(request: SessionRequest) -> dict[str, Any]:
    robot = ROBOTS.get(request.robot_id)
    if robot is None:
        raise HTTPException(404, "Robot not found. Upload or load a robot first.")
    session_id = uuid.uuid4().hex
    session = SimulationSession(session_id, robot)
    SESSIONS[session_id] = session
    return {"session_id": session_id, "robot": serializable_robot(robot), "state": session.state()}


@app.put("/api/sessions/{session_id}/demonstrations")
def save_demonstrations(session_id: str, request: DemonstrationsRequest) -> dict[str, Any]:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(404, "Session not found.")
    if len(request.demonstrations) > MAX_DEMONSTRATIONS:
        raise HTTPException(413, f"A maximum of {MAX_DEMONSTRATIONS} demonstrations is supported.")
    joint_count = len(session.joints)
    if any(len(item.current) != joint_count or len(item.target) != joint_count for item in request.demonstrations):
        raise HTTPException(422, "Each demonstration must contain one value per controllable joint.")
    session.demonstrations = [item.model_dump() for item in request.demonstrations]
    return {"status": "saved", "demonstrations": len(session.demonstrations)}


@app.post("/api/sessions/{session_id}/train")
async def train(session_id: str, request: TrainRequest) -> dict[str, str]:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(404, "Session not found.")
    if session.training:
        raise HTTPException(409, "Training is already running.")
    if len(request.demonstrations) > MAX_DEMONSTRATIONS:
        raise HTTPException(413, f"A maximum of {MAX_DEMONSTRATIONS} demonstrations is supported.")
    session.training = True
    asyncio.create_task(asyncio.to_thread(train_session, session, request))
    return {"status": "started"}


@app.post("/api/sessions/{session_id}/predict")
def predict(session_id: str, request: PredictRequest) -> dict[str, Any]:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(404, "Session not found.")
    if session.model is None:
        raise HTTPException(409, "Train a model before requesting a prediction.")
    if len(request.target) != len(session.joints):
        raise HTTPException(422, "The target pose does not match the robot joints.")
    current = request.current or [0.0] * len(session.joints)
    features = torch.tensor([normalized(current, session.joints) + normalized(request.target, session.joints)], dtype=torch.float32)
    with torch.no_grad():
        prediction = session.model(features)[0].tolist()
    positions = denormalized(prediction, session.joints)
    return {"target": request.target, "positions": positions, "error": max(abs(a - b) for a, b in zip(positions, request.target))}


@app.get("/api/sessions/{session_id}/export")
def export_session(session_id: str) -> StreamingResponse:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(404, "Session not found.")
    snapshot = {
        "robot": serializable_robot(session.robot),
        "demonstrations": session.demonstrations,
        "model_config": session.model_config,
        "positions": session.positions,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("session.json", json.dumps(snapshot, indent=2))
        archive.write(session.robot["path"], "robot.urdf")
        if session.model is not None:
            model_buffer = io.BytesIO()
            torch.save(session.model.state_dict(), model_buffer)
            archive.writestr("model.pt", model_buffer.getvalue())
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="robot-session-{session_id[:8]}.zip"'})


@app.websocket("/ws/sessions/{session_id}")
async def session_socket(websocket: WebSocket, session_id: str) -> None:
    session = SESSIONS.get(session_id)
    if session is None:
        await websocket.close(code=4404)
        return
    await websocket.accept()
    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive_json(), timeout=0.04)
                message_type = message.get("type")
                if message_type == "set_positions":
                    session.set_positions(message.get("positions", []))
                elif message_type == "reset":
                    session.set_positions([0.0] * len(session.joints))
                elif message_type == "step":
                    session.step()
            except asyncio.TimeoutError:
                pass
            except ValueError as exc:
                await websocket.send_json({"type": "error", "message": str(exc)})
            session.step()
            await websocket.send_json(session.state())
            if session.events:
                events = session.events[:]
                session.events.clear()
                for event in events:
                    await websocket.send_json(event)
    except WebSocketDisconnect:
        return
    except Exception:
        return


@app.on_event("shutdown")
def shutdown() -> None:
    for session in SESSIONS.values():
        session.close()
