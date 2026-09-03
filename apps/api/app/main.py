from __future__ import annotations

import asyncio
import io
import json
import math
import threading
import uuid
import zipfile
from pathlib import Path
from typing import Any, Literal
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
        default_velocity = 1.0 if joint_type == "prismatic" else 2.0
        velocity = number(limit.attrib.get("velocity") if limit is not None else None, default_velocity)
        if not math.isfinite(velocity) or velocity <= 0:
            velocity = default_velocity
        joints.append({
            "name": name,
            "type": joint_type,
            "parent": parent_name,
            "child": child_name,
            "origin": origin(joint.find("origin")),
            "axis": axis,
            "lower": lower,
            "upper": upper,
            "velocity": velocity,
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
    timestep_ms: int = Field(120, ge=10, le=2000)
    random_starts: int = Field(4, ge=0, le=64)
    random_seed: int = Field(7, ge=0, le=1_000_000)
    rollout_steps: int = Field(160, ge=1, le=2000)


class DemonstrationFrame(BaseModel):
    timestamp: float = Field(ge=0)
    positions: list[float]


class Keyframe(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    frame: int = Field(ge=0)
    timestamp: float = Field(ge=0)
    positions: list[float]
    interpolation: Literal["linear", "step"] = "linear"


class Demonstration(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    name: str = "Untitled pose"
    kind: str = "pose"
    current: list[float]
    target: list[float]
    frames: list[DemonstrationFrame] = Field(default_factory=list)
    keyframes: list[Keyframe] = Field(default_factory=list)
    timeline_fps: int = Field(30, ge=1, le=1000)
    duration_frames: int = Field(0, ge=0, le=100000)
    start_frame_index: int = Field(0, ge=0)
    dataset_id: str | None = None


class Dataset(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    name: str = "Untitled dataset"
    demonstration_ids: list[str] = Field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""


class DemonstrationsRequest(BaseModel):
    demonstrations: list[Demonstration]


class DatasetsRequest(BaseModel):
    datasets: list[Dataset]


class TrainRequest(BaseModel):
    demonstrations: list[Demonstration]
    config: TrainConfig = Field(default_factory=TrainConfig)  # type: ignore[arg-type]  # pyright needs a plugin for pydantic defaults; runtime-verified


class SessionRequest(BaseModel):
    robot_id: str


class PredictRequest(BaseModel):
    target: list[float]
    current: list[float] | None = None


class RolloutRequest(BaseModel):
    frames: list[DemonstrationFrame]
    current: list[float] | None = None
    timestep_ms: int = Field(120, ge=10, le=2000)
    max_steps: int = Field(160, ge=1, le=2000)
    approach_mode: Literal["scripted", "learned"] = "scripted"
    timeline_fps: int | None = Field(default=None, ge=1, le=1000)


class SimulationSession:
    def __init__(self, session_id: str, robot: dict[str, Any]):
        self.id = session_id
        self.robot = robot
        self.lock = threading.Lock()
        self.events: list[dict[str, Any]] = []
        self.training = False
        self.model: torch.nn.Module | None = None
        self.model_config: dict[str, Any] | None = None
        self.model_mode = "temporal"
        self.demonstrations: list[dict[str, Any]] = []
        self.datasets: list[dict[str, Any]] = []
        self.client = p.connect(p.DIRECT)
        p.setGravity(0, 0, -9.81, physicsClientId=self.client)
        self.body: int | None = None
        try:
            try:
                self.body = p.loadURDF(robot["path"], useFixedBase=True, physicsClientId=self.client, flags=p.URDF_USE_SELF_COLLISION)
            except TypeError:
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


def count_contacts_at(session: SimulationSession, positions: list[float]) -> int:
    """Collision probe: pose the simulated body and count contact points (self + environment)."""
    if session.body is None:
        return 0
    saved = list(session.positions)
    try:
        session.set_positions(list(positions))
        p.stepSimulation(physicsClientId=session.client)
        return len(p.getContactPoints(bodyA=session.body, physicsClientId=session.client))
    except Exception:
        return 0
    finally:
        try:
            session.set_positions(saved)
        except Exception:
            pass


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


def default_joint_velocity(joint_type: Any) -> float:
    return 1.0 if joint_type == "prismatic" else 2.0


def joint_velocity_limit(joint: dict[str, Any]) -> float:
    """Maximum joint velocity in native units per second (URDF or safe default)."""
    try:
        velocity = float(joint.get("velocity", default_joint_velocity(joint.get("type"))))
    except (TypeError, ValueError):
        velocity = default_joint_velocity(joint.get("type"))
    if not math.isfinite(velocity) or velocity <= 0:
        velocity = default_joint_velocity(joint.get("type"))
    return velocity


def max_joint_step(joint: dict[str, Any], timestep_ms: int) -> float:
    return max(joint_velocity_limit(joint) * max(1, timestep_ms) / 1000.0, 1e-6)


def approach_step_count(start: list[float], goal: list[float], joints: list[dict[str, Any]], timestep_ms: int, cap: int = 500) -> int:
    """Number of bounded increments needed to move from start to goal without teleporting."""
    steps = 1
    for index, joint in enumerate(joints):
        current = start[index] if index < len(start) else 0.0
        target = goal[index] if index < len(goal) else current
        distance = abs(target - current)
        needed = math.ceil(distance / max_joint_step(joint, timestep_ms))
        steps = max(steps, needed)
    return max(1, min(steps, cap))


def build_approach_plan(start: list[float], goal: list[float], joints: list[dict[str, Any]], timestep_ms: int) -> list[list[float]]:
    """Scripted stage-1 controller: bounded interpolation from any pose to a goal pose."""
    steps = approach_step_count(start, goal, joints, timestep_ms)
    return [_lerp_positions(list(start), list(goal), (index + 1) / steps) for index in range(steps)]


def _lerp_positions(start: list[float], end: list[float], progress: float) -> list[float]:
    return [
        value + ((end[index] if index < len(end) else value) - value) * progress
        for index, value in enumerate(start)
    ]


def _interpolate_frame_positions(frames: list[DemonstrationFrame], timestamp: float) -> list[float]:
    ordered = sorted(frames, key=lambda frame: frame.timestamp)
    if not ordered:
        return []
    if timestamp <= ordered[0].timestamp:
        return list(ordered[0].positions)
    if timestamp >= ordered[-1].timestamp:
        return list(ordered[-1].positions)
    next_index = next(index for index, frame in enumerate(ordered) if frame.timestamp >= timestamp)
    next_frame = ordered[next_index]
    previous = ordered[max(0, next_index - 1)]
    duration = max(next_frame.timestamp - previous.timestamp, 1.0)
    progress = (timestamp - previous.timestamp) / duration
    return _lerp_positions(previous.positions, next_frame.positions, progress)


def authored_frames(demonstration: Demonstration) -> list[DemonstrationFrame]:
    if demonstration.keyframes:
        return [
            DemonstrationFrame(timestamp=keyframe.timestamp, positions=keyframe.positions)
            for keyframe in sorted(demonstration.keyframes, key=lambda item: item.frame)
        ]
    return sorted(demonstration.frames, key=lambda frame: frame.timestamp)


def build_incremental_samples(
    demonstrations: list[Demonstration],
    joints: list[dict[str, Any]],
    timestep_ms: int,
    random_starts: int = 0,
    random_seed: int = 7,
) -> list[dict[str, Any]]:
    """Expand authored checkpoints into small next-state delta samples."""
    if timestep_ms < 1:
        raise ValueError("The training timestep must be positive.")
    rng = np.random.default_rng(random_seed)
    samples: list[dict[str, Any]] = []
    step = max(1, timestep_ms)

    for demonstration in demonstrations:
        frames = authored_frames(demonstration)
        if not frames:
            frames = [DemonstrationFrame(timestamp=0, positions=demonstration.target)]
        start_index = min(demonstration.start_frame_index, len(frames) - 1)
        frames = frames[start_index:]
        if any(len(frame.positions) != len(joints) for frame in frames):
            raise ValueError("Each timeline frame must contain one value per controllable joint.")
        if len(frames) == 1:
            frames = [
                DemonstrationFrame(timestamp=0, positions=demonstration.current),
                DemonstrationFrame(timestamp=step, positions=frames[0].positions),
            ]

        starts = [list(frames[0].positions)]
        for _ in range(random_starts):
            starts.append([
                joint["lower"] + (joint["upper"] - joint["lower"]) * rng.random()
                for joint in joints
            ])

        for start_index_value, initial in enumerate(starts):
            if start_index_value != 0:
                # Randomized start: expand the approach to the first checkpoint
                # over multiple velocity-bounded increments instead of one teleport.
                approach = build_approach_plan(list(initial), list(frames[0].positions), joints, step)
                previous = list(initial)
                for approach_index, waypoint in enumerate(approach):
                    progress = approach_index / len(approach)
                    current_normalized = normalized(previous, joints)
                    next_normalized = normalized(waypoint, joints)
                    samples.append({
                        "current": current_normalized,
                        "goal": normalized(frames[0].positions, joints),
                        "progress": progress,
                        "delta": [next_value - current_value for next_value, current_value in zip(next_normalized, current_normalized)],
                    })
                    previous = waypoint
            route = frames
            for segment_index in range(len(route) - 1):
                segment_start = route[segment_index]
                segment_end = route[segment_index + 1]
                duration = max(segment_end.timestamp - segment_start.timestamp, step)
                for elapsed in np.arange(0, duration, step):
                    progress = min(1.0, elapsed / duration)
                    next_progress = min(1.0, (elapsed + step) / duration)
                    current = _lerp_positions(segment_start.positions, segment_end.positions, progress)
                    next_state = _lerp_positions(segment_start.positions, segment_end.positions, next_progress)
                    current_normalized = normalized(current, joints)
                    next_normalized = normalized(next_state, joints)
                    samples.append({
                        "current": current_normalized,
                        "goal": normalized(segment_end.positions, joints),
                        "progress": progress,
                        "delta": [next_value - current_value for next_value, current_value in zip(next_normalized, current_normalized)],
                    })
    return samples


def train_session(session: SimulationSession, request: TrainRequest) -> None:
    try:
        if not request.demonstrations:
            raise ValueError("Capture at least one demonstration before training.")
        joint_count = len(session.joints)
        if any(len(item.current) != joint_count or len(item.target) != joint_count for item in request.demonstrations):
            raise ValueError("Each demonstration must contain one value per controllable joint.")
        torch.manual_seed(request.config.random_seed)
        samples = build_incremental_samples(
            request.demonstrations,
            session.joints,
            request.config.timestep_ms,
            request.config.random_starts,
            request.config.random_seed,
        )
        if not samples:
            raise ValueError("Capture at least two timeline checkpoints before training.")
        inputs = [sample["current"] + sample["goal"] + [sample["progress"]] for sample in samples]
        targets = [sample["delta"] for sample in samples]
        x = torch.tensor(inputs, dtype=torch.float32)
        y = torch.tensor(targets, dtype=torch.float32)
        model = make_model(joint_count * 2 + 1, joint_count, request.config)
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
                session.events.append({"type": "training", "epoch": epoch + 1, "epochs": steps, "loss": float(loss.item()), "samples": len(samples)})
        with session.lock:
            session.model = model.eval()
            session.model_config = request.config.model_dump()
            session.model_mode = "temporal"
            session.demonstrations = [item.model_dump() for item in request.demonstrations]
            session.events.append({"type": "training_complete", "loss": float(loss.item()), "demonstrations": len(request.demonstrations), "samples": len(samples)})
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
    for item in request.demonstrations:
        if any(len(frame.positions) != joint_count for frame in item.frames):
            raise HTTPException(422, "Timeline frames must match the controllable joints.")
        if any(len(keyframe.positions) != joint_count for keyframe in item.keyframes):
            raise HTTPException(422, "Keyframes must match the controllable joints.")
        if any(
            left.frame >= right.frame or left.timestamp >= right.timestamp
            for left, right in zip(item.keyframes, item.keyframes[1:])
        ):
            raise HTTPException(422, "Keyframes must be ordered by increasing frame and time.")
        if any(
            left.timestamp > right.timestamp
            for left, right in zip(item.frames, item.frames[1:])
        ):
            raise HTTPException(422, "Timeline frames must be ordered by timestamp.")
        authored_count = len(item.keyframes) or len(item.frames)
        if authored_count and item.start_frame_index >= authored_count:
            raise HTTPException(422, "The selected starting frame does not exist.")
    session.demonstrations = [item.model_dump() for item in request.demonstrations]
    return {"status": "saved", "demonstrations": len(session.demonstrations)}


@app.put("/api/sessions/{session_id}/datasets")
def save_datasets(session_id: str, request: DatasetsRequest) -> dict[str, Any]:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(404, "Session not found.")
    if len(request.datasets) > MAX_DEMONSTRATIONS:
        raise HTTPException(413, f"A maximum of {MAX_DEMONSTRATIONS} datasets is supported.")
    known_ids = {item["id"] for item in session.demonstrations}
    if any(
        demonstration_id not in known_ids
        for dataset in request.datasets
        for demonstration_id in dataset.demonstration_ids
    ):
        raise HTTPException(422, "Datasets may only contain demonstrations in this session.")
    session.datasets = [dataset.model_dump() for dataset in request.datasets]
    return {"status": "saved", "datasets": len(session.datasets)}


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
    if len(current) != len(session.joints):
        raise HTTPException(422, "The current pose does not match the robot joints.")
    current_normalized = normalized(current, session.joints)
    target_normalized = normalized(request.target, session.joints)
    if session.model_mode == "temporal":
        features = torch.tensor([current_normalized + target_normalized + [1.0]], dtype=torch.float32)
        with torch.no_grad():
            delta = session.model(features)[0].tolist()
        positions = denormalized([value + change for value, change in zip(current_normalized, delta)], session.joints)
    else:
        features = torch.tensor([current_normalized + target_normalized], dtype=torch.float32)
        with torch.no_grad():
            prediction = session.model(features)[0].tolist()
        positions = denormalized(prediction, session.joints)
    return {"target": request.target, "positions": positions, "error": max(abs(a - b) for a, b in zip(positions, request.target))}


@app.post("/api/sessions/{session_id}/rollout")
def rollout(session_id: str, request: RolloutRequest) -> dict[str, Any]:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(404, "Session not found.")
    if session.model is None:
        raise HTTPException(409, "Train a model before requesting a rollout.")
    if len(request.frames) < 2:
        raise HTTPException(422, "A rollout requires at least two checkpoints.")
    joint_count = len(session.joints)
    if any(len(frame.positions) != joint_count for frame in request.frames):
        raise HTTPException(422, "Each checkpoint must match the robot joints.")
    ordered = sorted(request.frames, key=lambda frame: frame.timestamp)
    current = request.current or list(ordered[0].positions)
    if len(current) != joint_count:
        raise HTTPException(422, "The current pose does not match the robot joints.")
    needs_approach = any(abs(a - b) > 1e-9 for a, b in zip(list(current), ordered[0].positions))
    result = [{"timestamp": 0, "positions": list(current), "expected": list(ordered[0].positions), "phase": "approach" if needs_approach else "gesture"}]
    current_timestamp = 0
    total_steps = 0
    # Stage 1: approach from a randomized start to the first checkpoint.
    # Default is the scripted bounded-interpolation controller; "learned"
    # runs the behavior model instead (kept for experiments only).
    approach_start = list(current)
    if any(abs(a - b) > 1e-9 for a, b in zip(approach_start, ordered[0].positions)):
        if request.approach_mode == "scripted":
            for waypoint in build_approach_plan(approach_start, list(ordered[0].positions), session.joints, request.timestep_ms):
                if total_steps >= request.max_steps:
                    break
                current = list(waypoint)
                current_timestamp += request.timestep_ms
                result.append({"timestamp": current_timestamp, "positions": list(current), "expected": list(waypoint), "phase": "approach"})
                total_steps += 1
        else:
            approach_steps = approach_step_count(approach_start, list(ordered[0].positions), session.joints, request.timestep_ms)
            for approach_index in range(approach_steps):
                if total_steps >= request.max_steps:
                    break
                progress = min(1.0, (approach_index + 1) / approach_steps)
                current_normalized = normalized(current, session.joints)
                target_normalized = normalized(ordered[0].positions, session.joints)
                features = torch.tensor([current_normalized + target_normalized + [progress]], dtype=torch.float32)
                with torch.no_grad():
                    delta = session.model(features)[0].tolist()
                current = denormalized([value + change for value, change in zip(current_normalized, delta)], session.joints)
                current_timestamp += request.timestep_ms
                expected = _lerp_positions(approach_start, ordered[0].positions, progress)
                result.append({"timestamp": current_timestamp, "positions": list(current), "expected": expected, "phase": "approach"})
                total_steps += 1
    # Gesture density follows the authored timeline frame grid (fps x duration)
    # so the predicted trajectory covers the motion faithfully; timestep_ms is
    # the fallback. The grid plan is capped by an explicit step budget so a
    # dense grid degrades to coarser full-gesture coverage, never a cut tail.
    try:
        grid_ms = 1000.0 / request.timeline_fps if request.timeline_fps else float(request.timestep_ms)
    except (TypeError, ValueError, ZeroDivisionError) as exc:
        raise HTTPException(422, f"Invalid timeline fps: {exc}") from exc
    raw_steps = []
    for checkpoint_index in range(1, len(ordered)):
        segment_ms = ordered[checkpoint_index].timestamp - ordered[checkpoint_index - 1].timestamp
        raw_steps.append(max(1, math.ceil(max(segment_ms, grid_ms) / grid_ms)))
    remaining = max(0, request.max_steps - total_steps)
    if sum(raw_steps) > remaining:
        scaled = [math.floor(steps * remaining / sum(raw_steps)) for steps in raw_steps] if remaining else [0] * len(raw_steps)
        leftover = remaining - sum(scaled)
        largest_first = sorted(range(len(raw_steps)), key=lambda index: raw_steps[index], reverse=True)
        index = 0
        while leftover > 0 and largest_first:
            scaled[largest_first[index % len(largest_first)]] += 1
            leftover -= 1
            index += 1
        raw_steps = scaled
    for checkpoint_index, segment_steps in zip(range(1, len(ordered)), raw_steps):
        checkpoint = ordered[checkpoint_index]
        for step_index in range(segment_steps):
            if total_steps >= request.max_steps:
                break
            progress = min(1.0, (step_index + 1) / segment_steps)
            current_normalized = normalized(current, session.joints)
            target_normalized = normalized(checkpoint.positions, session.joints)
            features = torch.tensor([current_normalized + target_normalized + [progress]], dtype=torch.float32)
            with torch.no_grad():
                delta = session.model(features)[0].tolist()
            current = denormalized([value + change for value, change in zip(current_normalized, delta)], session.joints)
            current_timestamp += request.timestep_ms
            expected = _lerp_positions(
                ordered[checkpoint_index - 1].positions,
                checkpoint.positions,
                progress,
            )
            result.append({"timestamp": current_timestamp, "positions": list(current), "expected": expected, "phase": "gesture"})
            total_steps += 1
        if total_steps >= request.max_steps:
            break
    collisions = 0
    for frame in result:
        collisions += count_contacts_at(session, frame["expected"])
    return {"frames": result, "steps": total_steps, "collisions": collisions}


@app.get("/api/sessions/{session_id}/export")
def export_session(session_id: str) -> StreamingResponse:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(404, "Session not found.")
    snapshot = {
        "robot": serializable_robot(session.robot),
        "demonstrations": session.demonstrations,
        "datasets": session.datasets,
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
