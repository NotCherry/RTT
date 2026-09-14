from __future__ import annotations

import asyncio
import hashlib
import io
import json
import math
import threading
import time
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
from .session_runtime import SessionEvents, serialized

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_JOINTS = 32
MAX_DEMONSTRATIONS = 2000
MAX_EPOCHS = 5000
SESSION_IDLE_SECONDS = 30 * 60

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


def active_session(session_id: str) -> "SimulationSession | None":
    session = SESSIONS.get(session_id)
    if session is not None:
        with session.lock:
            if session.closed:
                return None
            session.last_activity = time.monotonic()
    return session

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
    <limit lower="-1.57" upper="1.57" effort="100" velocity="5"/>
  </joint>
  <joint name="elbow_joint" type="revolute">
    <parent link="shoulder"/><child link="forearm"/>
    <origin xyz="0 0 1.2"/><axis xyz="0 1 0"/>
    <limit lower="-2.2" upper="2.2" effort="100" velocity="5"/>
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

PHYSICS_TIMESTEP = 1.0 / 240.0
DEFAULT_LINK_MASS = 1.0

def _compute_box_inertia(mass: float, size: list[float]) -> dict[str, float]:
    sx, sy, sz = size
    return {
        "ixx": mass / 12.0 * (sy * sy + sz * sz),
        "ixy": 0.0,
        "ixz": 0.0,
        "iyy": mass / 12.0 * (sx * sx + sz * sz),
        "iyz": 0.0,
        "izz": mass / 12.0 * (sx * sx + sy * sy),
    }

def _compute_cylinder_inertia(mass: float, radius: float, length: float) -> dict[str, float]:
    r2 = radius * radius
    return {
        "ixx": mass / 12.0 * (3 * r2 + length * length),
        "ixy": 0.0,
        "ixz": 0.0,
        "iyy": mass / 12.0 * (3 * r2 + length * length),
        "iyz": 0.0,
        "izz": mass * r2 / 2.0,
    }

def _compute_sphere_inertia(mass: float, radius: float) -> dict[str, float]:
    i = 2.0 / 5.0 * mass * radius * radius
    return {"ixx": i, "ixy": 0.0, "ixz": 0.0, "iyy": i, "iyz": 0.0, "izz": i}

def synthesize_inertia(geometry: dict[str, Any], mass: float) -> dict[str, float]:
    gtype = geometry.get("type")
    if gtype == "box":
        size = geometry.get("size", [0.2, 0.2, 0.2])
        try:
            sx, sy, sz = float(size[0]), float(size[1]), float(size[2])
        except Exception:
            sx, sy, sz = 0.2, 0.2, 0.2
        return _compute_box_inertia(mass, [sx, sy, sz])
    if gtype == "cylinder":
        try:
            radius = float(geometry.get("radius", 0.1))
            length = float(geometry.get("length", 0.3))
        except Exception:
            radius, length = 0.1, 0.3
        return _compute_cylinder_inertia(mass, radius, length)
    if gtype == "sphere":
        try:
            radius = float(geometry.get("radius", 0.1))
        except Exception:
            radius = 0.1
        return _compute_sphere_inertia(mass, radius)
    return {"ixx": 0.01, "ixy": 0.0, "ixz": 0.0, "iyy": 0.01, "iyz": 0.0, "izz": 0.01}


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
        collisions: list[dict[str, Any]] = []
        for collision in link.findall("collision"):
            geometry_element = collision.find("geometry")
            if geometry_element is None:
                continue
            geometry = parse_geometry(geometry_element, name)
            collisions.append({"geometry": geometry, "origin": origin(collision.find("origin"))})
        if not collisions and visuals:
            collisions = [{"geometry": dict(item["geometry"]), "origin": dict(item["origin"])} for item in visuals]
        inertial_elem = link.find("inertial")
        inertial: dict[str, Any]
        synthesized = False
        if inertial_elem is not None:
            mass_value = inertial_elem.find("mass")
            inertia_value = inertial_elem.find("inertia")
            inertial_origin = origin(inertial_elem.find("origin"))
            if mass_value is not None and mass_value.attrib.get("value") is not None:
                try:
                    mass = float(mass_value.attrib.get("value", ""))
                except (TypeError, ValueError) as exc:
                    raise ValueError(f"Link '{name}' has invalid inertial mass.") from exc
                if not math.isfinite(mass) or mass <= 0:
                    raise ValueError(f"Link '{name}' has invalid inertial mass '{mass}'. Mass must be a finite positive number.")
            else:
                mass = DEFAULT_LINK_MASS
                synthesized = True
            if inertia_value is not None:
                inertia_elem = inertia_value
                def _inertia_attr(key: str, default: str | None) -> float:
                    raw = inertia_elem.attrib.get(key)
                    if raw is None or raw.strip() == "":
                        if default is None:
                            raise ValueError(f"Link '{name}' missing inertia attribute '{key}'.")
                        raw = default
                    try:
                        return float(raw)
                    except (TypeError, ValueError) as exc:
                        raise ValueError(f"Link '{name}' has invalid inertia value '{key}={raw}'.") from exc
                try:
                    ixx = _inertia_attr("ixx", None)
                    iyy = _inertia_attr("iyy", None)
                    izz = _inertia_attr("izz", None)
                    ixy = _inertia_attr("ixy", "0")
                    ixz = _inertia_attr("ixz", "0")
                    iyz = _inertia_attr("iyz", "0")
                except ValueError as exc:
                    # If principal components missing, fall back to synthesized inertia
                    if "missing inertia attribute" in str(exc):
                        base_geom = collisions[0]["geometry"] if collisions else (visuals[0]["geometry"] if visuals else {"type": "box", "size": [0.2, 0.2, 0.2]})
                        inertia = synthesize_inertia(base_geom, mass)
                        synthesized = True
                    else:
                        raise
                else:
                    if not all(math.isfinite(v) for v in [ixx, iyy, izz, ixy, ixz, iyz]):
                        raise ValueError(f"Link '{name}' has non-finite inertia.")
                    if ixx <= 0 or iyy <= 0 or izz <= 0:
                        raise ValueError(f"Link '{name}' has non-positive principal inertia (ixx,iyy,izz must be >0).")
                    tensor = np.array([[ixx, ixy, ixz], [ixy, iyy, iyz], [ixz, iyz, izz]])
                    if np.any(np.linalg.eigvalsh(tensor) <= 0):
                        raise ValueError(f"Link '{name}' inertia must be positive-definite.")
                    inertia = {"ixx": ixx, "iyy": iyy, "izz": izz, "ixy": ixy, "ixz": ixz, "iyz": iyz}
            else:
                base_geom = collisions[0]["geometry"] if collisions else (visuals[0]["geometry"] if visuals else {"type": "box", "size": [0.2, 0.2, 0.2]})
                inertia = synthesize_inertia(base_geom, mass)
                synthesized = True
        else:
            base_geom = collisions[0]["geometry"] if collisions else (visuals[0]["geometry"] if visuals else {"type": "box", "size": [0.2, 0.2, 0.2]})
            mass = DEFAULT_LINK_MASS
            inertia = synthesize_inertia(base_geom, mass)
            inertial_origin = {"xyz": [0.0, 0.0, 0.0], "rpy": [0.0, 0.0, 0.0]}
            synthesized = True
        inertial = {"mass": mass, "inertia": inertia, "origin": inertial_origin, "synthesized": synthesized}
        links.append({"name": name, "visuals": visuals, "collisions": collisions, "inertial": inertial})

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
        default_effort = 20.0
        effort = number(limit.attrib.get("effort") if limit is not None else None, default_effort)
        if not math.isfinite(effort) or effort <= 0:
            effort = default_effort
        dynamics_elem = joint.find("dynamics")
        damping = number(dynamics_elem.attrib.get("damping") if dynamics_elem is not None else None, 0.0)
        friction = number(dynamics_elem.attrib.get("friction") if dynamics_elem is not None else None, 0.0)
        if not math.isfinite(damping) or damping < 0:
            damping = 0.0
        if not math.isfinite(friction) or friction < 0:
            friction = 0.0
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
            "effort": effort,
            "damping": damping,
            "friction": friction,
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
        "gravity": [0.0, 0.0, -9.81],
        "use_fixed_base": True,
        "physics_timestep": PHYSICS_TIMESTEP,
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
    physics: bool = Field(True, description="When true, generate physics-feasible deltas; false uses kinematic teleport for fast training.")
    coordination_weight: float = Field(0.5, ge=0.0, le=5.0, description="Emphasis on simultaneous-motion samples — see CONTEXT.md Coordination.")


class DemonstrationFrame(BaseModel):
    timestamp: float = Field(ge=0)
    positions: list[float]
    interpolation: Literal["linear", "step"] = "linear"


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
    gravity: list[float] | None = Field(default=None, description="Optional gravity vector [x,y,z]; defaults to robot gravity.")
    use_fixed_base: bool | None = Field(default=None, description="Override fixed base; defaults to robot setting.")


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
    physics: bool = Field(True, description="When true, rollout servos through PyBullet with substeps; false uses kinematic assign.")
    gravity: list[float] | None = Field(default=None, description="Optional gravity override for this rollout.")
    use_fixed_base: bool | None = Field(default=None)


class SimulationSession:
    def __init__(self, session_id: str, robot: dict[str, Any], gravity: list[float] | None = None, use_fixed_base: bool | None = None):
        self.id = session_id
        self.last_activity = time.monotonic()
        self.closed = False
        self.robot = robot
        self.lock = threading.RLock()
        self.events = SessionEvents()
        self.training = False
        self.training_thread: threading.Thread | None = None
        self.cancel_training = threading.Event()
        self.model: torch.nn.Module | None = None
        self.model_config: dict[str, Any] | None = None
        self.model_mode = "temporal"
        self.demonstrations: list[dict[str, Any]] = []
        self.datasets: list[dict[str, Any]] = []
        self.client = p.connect(p.DIRECT)
        resolved_gravity = gravity if gravity is not None else robot.get("gravity", [0.0, 0.0, -9.81])
        try:
            gx, gy, gz = float(resolved_gravity[0]), float(resolved_gravity[1]), float(resolved_gravity[2])
        except Exception:
            gx, gy, gz = 0.0, 0.0, -9.81
        self.gravity = [gx, gy, gz]
        p.setGravity(gx, gy, gz, physicsClientId=self.client)
        try:
            p.setTimeStep(float(robot.get("physics_timestep", PHYSICS_TIMESTEP)), physicsClientId=self.client)
        except Exception:
            p.setTimeStep(PHYSICS_TIMESTEP, physicsClientId=self.client)
        self.use_fixed_base = robot.get("use_fixed_base", True) if use_fixed_base is None else bool(use_fixed_base)
        self.body: int | None = None
        try:
            try:
                self.body = p.loadURDF(robot["path"], useFixedBase=self.use_fixed_base, physicsClientId=self.client, flags=p.URDF_USE_SELF_COLLISION)
            except TypeError:
                self.body = p.loadURDF(robot["path"], useFixedBase=self.use_fixed_base, physicsClientId=self.client)
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
        for link in robot.get("links", []):
            inertial = link.get("inertial", {})
            if inertial.get("synthesized"):
                self.events.append({"type": "warning", "message": f"Link '{link.get('name')}' inertial mass/inertia synthesized from geometry (mass={inertial.get('mass')}). Re-upload URDF with explicit <inertial> for precise dynamics."})
        if self.body is not None:
            try:
                link_mass_map = {link.get("name"): link.get("inertial", {}) for link in robot.get("links", [])}
                # Override synthesized masses via changeDynamics so PyBullet respects them
                # Build pybullet index -> link name map
                pb_index_to_link: dict[int, str] = {-1: str(robot.get("root", ""))}
                for pb_idx in range(p.getNumJoints(self.body, physicsClientId=self.client)):
                    try:
                        info = p.getJointInfo(self.body, pb_idx, physicsClientId=self.client)
                        link_name = info[12].decode("utf-8") if isinstance(info[12], bytes) else str(info[12])
                        pb_index_to_link[pb_idx] = link_name
                    except Exception:
                        continue
                for pb_idx, link_name in pb_index_to_link.items():
                    inertial = link_mass_map.get(link_name, {})
                    if not inertial.get("synthesized"):
                        continue
                    mass = float(inertial.get("mass", DEFAULT_LINK_MASS))
                    inertia = inertial.get("inertia", {})
                    try:
                        ixx = float(inertia.get("ixx", 0.01))
                        iyy = float(inertia.get("iyy", 0.01))
                        izz = float(inertia.get("izz", 0.01))
                    except Exception:
                        ixx, iyy, izz = 0.01, 0.01, 0.01
                    try:
                        p.changeDynamics(self.body, pb_idx, mass=mass, localInertiaDiagonal=[ixx, iyy, izz], physicsClientId=self.client)
                    except Exception:
                        pass
                # Validation via getDynamicsInfo
                for pb_idx in list(pb_index_to_link.keys())[:5]:
                    try:
                        dyn_mass = p.getDynamicsInfo(self.body, pb_idx, physicsClientId=self.client)[0]
                        if not math.isfinite(dyn_mass) or dyn_mass < 0:
                            self.events.append({"type": "warning", "message": f"Link '{pb_index_to_link.get(pb_idx)}' has invalid dynamics mass {dyn_mass}."})
                    except Exception:
                        pass
            except Exception:
                pass

    def _apply_positions(self) -> None:
        if self.body is None:
            return
        for position, index in zip(self.positions, self.pybullet_indices):
            p.resetJointState(self.body, index, position, physicsClientId=self.client)

    @serialized
    def set_positions(self, values: list[float]) -> None:
        if len(values) != len(self.joints):
            raise ValueError("The number of joint positions does not match the robot.")
        try:
            self.positions = [clamp(float(value), joint["lower"], joint["upper"]) for value, joint in zip(values, self.joints)]
        except (TypeError, ValueError) as exc:
            raise ValueError("Joint positions must be numeric.") from exc
        self._apply_positions()

    @serialized
    def servo_to_positions(self, targets: list[float], timestep_ms: int) -> dict[str, Any]:
        """Physics-realistic servo: POSITION_CONTROL with effort/velocity limits + substeps."""
        if self.body is None or not self.pybullet_indices:
            self.set_positions(targets)
            return {"achieved": list(self.positions), "tracking_error": 0.0, "clipped": 0}
        try:
            clamped = [clamp(float(v), j["lower"], j["upper"]) for v, j in zip(targets, self.joints)]
        except (TypeError, ValueError) as exc:
            raise ValueError("Joint positions must be numeric.") from exc
        for target, index, joint in zip(clamped, self.pybullet_indices, self.joints):
            try:
                p.setJointMotorControl2(
                    self.body,
                    index,
                    p.POSITION_CONTROL,
                    targetPosition=target,
                    force=float(joint.get("effort", 20.0)),
                    maxVelocity=float(joint.get("velocity", 2.0)),
                    physicsClientId=self.client,
                )
            except Exception as exc:
                raise RuntimeError("Unable to command the physics joint.") from exc
        try:
            substeps = max(1, int(round(float(timestep_ms) / 1000.0 / PHYSICS_TIMESTEP))) if timestep_ms else 1
        except (TypeError, ValueError, ZeroDivisionError):
            substeps = 1
        substeps = max(1, min(substeps, 200))
        for _ in range(substeps):
            p.stepSimulation(physicsClientId=self.client)
        achieved: list[float] = []
        for index, joint in zip(self.pybullet_indices, self.joints):
            try:
                achieved.append(float(p.getJointState(self.body, index, physicsClientId=self.client)[0]))
            except Exception as exc:
                raise RuntimeError("Unable to read the achieved physics position.") from exc
        self.positions = achieved
        errors = [abs(a - t) for a, t in zip(achieved, clamped)]
        tracking_error = max(errors) if errors else 0.0
        clipped = sum(1 for e in errors if e > 1e-4)
        return {"achieved": achieved, "tracking_error": tracking_error, "clipped": clipped}

    @serialized
    def set_gravity(self, gravity: list[float]) -> None:
        try:
            gx, gy, gz = float(gravity[0]), float(gravity[1]), float(gravity[2])
        except Exception as exc:
            raise ValueError("Gravity must be a 3-element numeric vector.") from exc
        self.gravity = [gx, gy, gz]
        p.setGravity(gx, gy, gz, physicsClientId=self.client)

    @serialized
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

    @serialized
    def state(self) -> dict[str, Any]:
        self.last_activity = time.monotonic()
        return {"type": "state", "positions": list(self.positions), "training": self.training}

    @serialized(allow_closed=True)
    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        if p.isConnected(self.client):
            p.disconnect(self.client)

    @serialized
    def begin_training(self) -> None:
        self.check_training_cancelled()
        if self.training:
            raise ValueError("Training is already running.")
        self.training = True
        self.last_activity = time.monotonic()

    def check_training_cancelled(self) -> None:
        if self.cancel_training.is_set():
            raise ValueError("Training cancelled because the session is shutting down.")

    @serialized
    def start_training(self, request: TrainRequest) -> None:
        self.begin_training()
        self.training_thread = threading.Thread(target=train_session, args=(self, request), daemon=True)
        try:
            self.training_thread.start()
        except Exception:
            self.training = False
            self.training_thread = None
            raise

def _resolve_rollout_step(session: "SimulationSession", predicted: list[float], timestep_ms: int, use_physics: bool) -> tuple[list[float], float, int]:
    """Apply predicted positions via physics servo or kinematic assign; returns (achieved, tracking_error, clipped)."""
    if use_physics:
        try:
            step_ms = int(timestep_ms) if timestep_ms else 0
        except (TypeError, ValueError):
            step_ms = 0
        try:
            servo = session.servo_to_positions(list(predicted), step_ms)
            achieved = list(servo["achieved"])
            tracking_error = float(servo["tracking_error"])
            clipped = int(servo["clipped"])
            return achieved, tracking_error, clipped
        except Exception as exc:
            raise HTTPException(503, "Physics simulation failed; no achieved trajectory is available.") from exc
    try:
        return list(predicted), 0.0, 0
    except Exception:
        return [], 0.0, 0


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


def expected_input_size(joint_count: int) -> int:
    """Temporal MLP input size with previous-delta history (still MLP-simple)."""
    return joint_count * 3 + 1


def build_features(
    current_normalized: list[float],
    goal_normalized: list[float],
    progress: float,
    previous_delta: list[float],
    expected_size: int,
) -> "torch.Tensor":
    """Build model features with backward compat for pre-history models."""
    base = list(current_normalized) + list(goal_normalized) + [progress]
    if expected_size == len(current_normalized) * 3 + 1:
        base = base + list(previous_delta)
    return torch.tensor([base], dtype=torch.float32)


def model_expected_size(model: torch.nn.Module, joint_count: int) -> int:
    try:
        in_features = model[0].in_features  # type: ignore[index]
        return int(in_features)
    except Exception:
        return joint_count * 2 + 1


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

# --- Rollout density (deep module: budget-aware step scaling) ---
class RolloutBudget(BaseModel):
    """Bundle for rollout density inputs — resolves Data Clumps smell."""
    segment_ms_list: list[float]
    grid_ms: float
    max_steps: int
    total_steps: int


class SegmentScaleParams(BaseModel):
    """Bundle for per-segment scale computation."""
    segment_ms: float
    segment_steps: int
    step_ms: int
    grid_ms: float


def _compute_rollout_density_bundled(budget: RolloutBudget) -> dict[str, Any]:
    raw_steps = [max(1, math.ceil(max(seg_ms, budget.grid_ms) / budget.grid_ms)) for seg_ms in budget.segment_ms_list]
    remaining = max(0, budget.max_steps - budget.total_steps)
    if sum(raw_steps) > remaining:
        if remaining >= len(raw_steps) and len(raw_steps) > 0:
            # Guarantee at least 1 step per segment to preserve interior checkpoints
            scaled = [1] * len(raw_steps)
            remaining_after_min = remaining - len(raw_steps)
            if remaining_after_min > 0:
                extra_weights = [max(0, r - 1) for r in raw_steps]
                total_extra = sum(extra_weights) or len(raw_steps)
                try:
                    extra = [math.floor(w * remaining_after_min / total_extra) for w in extra_weights]
                except Exception:
                    extra = [0] * len(raw_steps)
                scaled = [s + e for s, e in zip(scaled, extra)]
                leftover = remaining - sum(scaled)
                largest_first = sorted(range(len(raw_steps)), key=lambda i: raw_steps[i], reverse=True)
                idx = 0
                while leftover > 0 and largest_first:
                    scaled[largest_first[idx % len(largest_first)]] += 1
                    leftover -= 1
                    idx += 1
            scaled_steps = scaled
        else:
            scaled = [math.floor(steps * remaining / sum(raw_steps)) for steps in raw_steps] if remaining else [0] * len(raw_steps)
            leftover = remaining - sum(scaled)
            largest_first = sorted(range(len(raw_steps)), key=lambda i: raw_steps[i], reverse=True)
            idx = 0
            while leftover > 0 and largest_first:
                scaled[largest_first[idx % len(largest_first)]] += 1
                leftover -= 1
                idx += 1
            scaled_steps = scaled
    else:
        scaled_steps = list(raw_steps)
    density_ratio = sum(raw_steps) / max(1, sum(scaled_steps)) if scaled_steps and sum(scaled_steps) else 1.0
    return {
        "raw_steps": raw_steps,
        "scaled_steps": scaled_steps,
        "remaining": remaining,
        "density_ratio": density_ratio,
        "grid_ms": budget.grid_ms,
    }


def compute_rollout_density(
    segment_ms_list: list[float],
    grid_ms: float,
    max_steps: int,
    total_steps: int,
) -> dict[str, Any]:
    """Deep module: pure density computation behind small interface.

    Inputs: segment durations in ms, grid in ms, budget max_steps and already-consumed total_steps.
    Outputs: {raw_steps, scaled_steps, scale, remaining, density_ratio} for testability.
    No side effects — test via interface, not implementation.
    """
    return _compute_rollout_density_bundled(
        RolloutBudget(segment_ms_list=segment_ms_list, grid_ms=grid_ms, max_steps=max_steps, total_steps=total_steps)
    )

def _compute_effective_scale_bundled(params: SegmentScaleParams) -> float:
    if params.segment_steps <= 0 or params.step_ms <= 0:
        return 1.0
    try:
        effective_ms_per_step = float(params.segment_ms) / float(params.segment_steps)
        scale = effective_ms_per_step / float(params.step_ms)
        if not math.isfinite(scale) or scale <= 0:
            return 1.0
        max_scale = 3.0
        if scale > max_scale:
            scale = max_scale
        return float(scale)
    except (TypeError, ValueError, ZeroDivisionError):
        return 1.0


def compute_effective_scale(
    segment_ms: float,
    segment_steps: int,
    step_ms: int,
    grid_ms: float,
) -> float:
    """Deep module: decimation-aware scale."""
    return _compute_effective_scale_bundled(
        SegmentScaleParams(segment_ms=segment_ms, segment_steps=segment_steps, step_ms=step_ms, grid_ms=grid_ms)
    )


def check_budget_exhaustion(remaining: int, max_steps: int, density_ratio: float | None = None) -> dict[str, str] | None:
    """Deep module: pure warning when gesture budget exhausted or trimmed."""
    try:
        if remaining == 0 and max_steps > 0:
            return {
                "type": "warning",
                "message": f"Gesture trimmed: approach consumed max_steps budget ({max_steps}), 0 gesture steps emitted",
            }
        if density_ratio is not None and density_ratio > 1.01:
            return {
                "type": "warning",
                "message": f"Gesture decimated: density {density_ratio:.2f}x (budget {max_steps} < raw steps), trajectory sparsified",
            }
        return None
    except (TypeError, ValueError):
        return None

def velocity_feasibility_findings(
    frames: list[DemonstrationFrame],
    joints: list[dict[str, Any]],
) -> list[dict[str, str]]:
    """Per-segment check that authored checkpoint timing is physically feasible.

    The demanded joint speed |Δpos|/segment_duration must stay within the
    URDF velocity limit; otherwise no model can put the robot at the middle
    checkpoint on time under physics-realistic replay (see
    docs/research/training-middle-frame-revalidation.md, RC2). One finding per
    infeasible segment, naming the worst offending joints.
    """
    ordered = sorted(frames, key=lambda frame: frame.timestamp)
    findings: list[dict[str, str]] = []
    for segment_index in range(len(ordered) - 1):
        start = ordered[segment_index]
        end = ordered[segment_index + 1]
        try:
            duration_ms = float(end.timestamp) - float(start.timestamp)
            end_timestamp = float(end.timestamp)
        except (TypeError, ValueError):
            continue
        if duration_ms <= 0:
            continue
        offenders: list[str] = []
        for joint_index, joint in enumerate(joints):
            try:
                delta = abs(float(end.positions[joint_index]) - float(start.positions[joint_index]))
                limit = joint_velocity_limit(joint)
                demanded = delta / (duration_ms / 1000.0)
            except (IndexError, TypeError, ValueError, ZeroDivisionError):
                continue
            if demanded > limit * 1.001:
                name = str(joint.get("name", f"joint {joint_index}"))
                offenders.append(f"{name}: {demanded:.2f} needed vs {limit:.2f} limit")
        if offenders:
            try:
                findings.append({
                    "type": "warning",
                    "message": (
                        f"Checkpoint timing infeasible: segment {segment_index + 1} "
                        f"(checkpoint at {end_timestamp:.0f} ms) demands more than the joint "
                        f"velocity limit — {'; '.join(offenders)}. The robot cannot be there on "
                        "time; slow the gesture timing or raise the joint velocity limit."
                    ),
                })
            except (TypeError, ValueError):
                continue
    return findings


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
    # Step interpolation: hold previous until next timestamp
    try:
        if getattr(previous, "interpolation", "linear") == "step":
            return list(previous.positions)
    except Exception:
        pass
    duration = max(next_frame.timestamp - previous.timestamp, 1.0)
    progress = (timestamp - previous.timestamp) / duration
    return _lerp_positions(previous.positions, next_frame.positions, progress)


def authored_frames(demonstration: Demonstration) -> list[DemonstrationFrame]:
    if demonstration.keyframes:
        return [
            DemonstrationFrame(timestamp=keyframe.timestamp, positions=list(keyframe.positions), interpolation=getattr(keyframe, "interpolation", "linear") or "linear")
            for keyframe in sorted(demonstration.keyframes, key=lambda item: item.frame)
        ]
    return sorted(demonstration.frames, key=lambda frame: frame.timestamp)


def build_physics_feasible_samples(
    samples: list[dict[str, Any]],
    joints: list[dict[str, Any]],
    timestep_ms: int,
    session: "SimulationSession",
) -> list[dict[str, Any]]:
    with session.lock:
        return _build_physics_feasible_samples(samples, joints, timestep_ms, session)


def _build_physics_feasible_samples(samples, joints, timestep_ms, session):
    """Convert kinematic deltas to physics-feasible deltas via POSITION_CONTROL servo."""
    if session.body is None or not session.pybullet_indices:
        return samples
    saved = list(session.positions)
    feasible: list[dict[str, Any]] = []
    fallbacks = 0
    joint_count = len(joints)
    prev_corrected: list[float] | None = None
    try:
        for sample in samples:
            session.check_training_cancelled()
            current_norm = sample["current"]
            # Update stale previous_delta to physics-corrected previous step
            if prev_corrected is not None:
                try:
                    # Only replace if sample had a previous delta (non-zero start)
                    # Keep zeros at segment starts as is
                    if any(abs(v) > 1e-9 for v in sample.get("previous_delta", [])):
                        sample = dict(sample)
                        sample["previous_delta"] = list(prev_corrected)
                except Exception:
                    pass
            try:
                cur_pos = denormalized(list(current_norm), joints)
                session.set_positions(cur_pos)
                delta_norm = sample["delta"]
                next_norm = [c + d for c, d in zip(current_norm, delta_norm)]
                target_pos = denormalized(next_norm, joints)
                result = session.servo_to_positions(target_pos, timestep_ms)
                achieved = result["achieved"]
                achieved_norm = normalized(achieved, joints)
                feasible_delta = [a - c for a, c in zip(achieved_norm, current_norm)]
                corrected_delta = [d + (d - f) for d, f in zip(delta_norm, feasible_delta)]
                new_sample = dict(sample)
                new_sample["delta"] = corrected_delta
                feasible.append(new_sample)
                prev_corrected = list(corrected_delta)
            except Exception:
                fallbacks += 1
                feasible.append(sample)
                try:
                    prev_corrected = list(sample["delta"])
                except Exception:
                    prev_corrected = [0.0] * joint_count
    finally:
        try:
            session.set_positions(saved)
        except Exception:
            pass
    if fallbacks:
        session.events.append({
            "type": "warning",
            "message": f"Physics sampling failed for {fallbacks} of {len(samples)} samples; those samples use kinematic targets.",
        })
    return feasible

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

        joint_count = len(joints)
        for start_index_value, initial in enumerate(starts):
            if start_index_value != 0:
                approach = build_approach_plan(list(initial), list(frames[0].positions), joints, step)
                previous = list(initial)
                previous_delta = [0.0] * joint_count
                for approach_index, waypoint in enumerate(approach):
                    progress = (approach_index + 1) / len(approach)
                    current_normalized = normalized(previous, joints)
                    next_normalized = normalized(waypoint, joints)
                    delta = [next_value - current_value for next_value, current_value in zip(next_normalized, current_normalized)]
                    samples.append({
                        "current": current_normalized,
                        "goal": normalized(frames[0].positions, joints),
                        "progress": progress,
                        "previous_delta": list(previous_delta),
                        "delta": delta,
                    })
                    previous_delta = list(delta)
                    previous = waypoint
            route = frames
            # Carry previous_delta across segments to preserve momentum through interior checkpoints
            # (reset only at gesture start, not each segment).
            # Segment-aware interpolation: step holds previous until end.
            carry_delta: list[float] = [0.0] * joint_count
            for segment_index in range(len(route) - 1):
                segment_start = route[segment_index]
                segment_end = route[segment_index + 1]
                duration = max(segment_end.timestamp - segment_start.timestamp, step)
                previous_delta = list(carry_delta) if segment_index > 0 else [0.0] * joint_count
                is_step = getattr(segment_start, "interpolation", "linear") == "step"
                for elapsed in np.arange(0, duration, step):
                    progress = min(1.0, elapsed / duration)
                    next_progress = min(1.0, (elapsed + step) / duration)
                    if is_step:
                        # Step interpolation: hold previous until the segment end
                        current = list(segment_start.positions)
                        next_state = list(segment_end.positions) if next_progress >= 1.0 else list(segment_start.positions)
                    else:
                        current = _lerp_positions(segment_start.positions, segment_end.positions, progress)
                        next_state = _lerp_positions(segment_start.positions, segment_end.positions, next_progress)
                    current_normalized = normalized(current, joints)
                    next_normalized = normalized(next_state, joints)
                    delta = [next_value - current_value for next_value, current_value in zip(next_normalized, current_normalized)]
                    samples.append({
                        "current": current_normalized,
                        "goal": normalized(segment_end.positions, joints),
                        "progress": next_progress,
                        "previous_delta": list(previous_delta),
                        "delta": delta,
                    })
                    # DART-lite corrective sample
                    try:
                        if rng.random() < 0.25:
                            noise = rng.normal(0.0, 0.01, size=joint_count)
                            cn = [max(-1.0, min(1.0, c + n)) for c, n in zip(current_normalized, noise)]
                            if any(abs(a - b) > 1e-9 for a, b in zip(cn, current_normalized)):
                                dn = [nn - c for nn, c in zip(next_normalized, cn)]
                                samples.append({"current": cn, "goal": normalized(segment_end.positions, joints), "progress": next_progress, "previous_delta": list(previous_delta), "delta": dn})
                    except Exception:
                        pass
                    previous_delta = list(delta)
                # Preserve momentum into next segment
                carry_delta = list(previous_delta)
    return samples


# --- Simultaneous-motion enforcement -------------------------------------
# A pure per-joint regression loss (SmoothL1/MSE on deltas) cannot tell a
# diagonal joint-space path (both joints together) from an L-shaped path
# (one joint, then the other): both reach the same final pose, so the final
# error looks low while the gesture is wrong. These helpers add two
# coordination terms that stay MLP-simple (no recurrence, no new inputs):
# a direction term (predicted delta must point the same way as the target
# delta) and a simultaneity term (every jointly-moving target joint must
# actually move in the prediction).
# --- Coordination (simultaneous motion — see CONTEXT.md) ---
COORDINATION_ABS_EPS = 0.005
COORDINATION_REL_RATIO = 0.2
COORDINATION_MAG_RATIO = 0.4
COORDINATION_SIMULTANEITY_THRESHOLD = 0.6
COORDINATION_DIRECTION_THRESHOLD = 0.7


def _coordination_hit(t_val: float, p_val: float) -> bool:
    """Shared predicate: predicted joint moved enough in the same direction as target."""
    if (t_val * p_val) <= 0:
        return False
    try:
        threshold = min(COORDINATION_ABS_EPS, COORDINATION_MAG_RATIO * abs(t_val))
    except (TypeError, ValueError):
        return False
    return abs(p_val) >= threshold


def _cosine_similarity(a_vals: list[float], b_vals: list[float]) -> float | None:
    """Cosine between two delta vectors; None if degenerate."""
    try:
        a_norm = math.sqrt(sum(v * v for v in a_vals))
        b_norm = math.sqrt(sum(v * v for v in b_vals))
    except (TypeError, ValueError):
        return None
    if a_norm <= 1e-9 or b_norm <= 1e-12:
        return None
    try:
        dot = sum(x * y for x, y in zip(a_vals, b_vals))
        denom = max(a_norm * b_norm, 1e-9)
        return max(-1.0, min(1.0, dot / denom))
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def expected_active_mask(target_row: list[float] | Any) -> list[bool]:
    """Joints the demonstration expects to move together on this step."""
    try:
        values = [float(v) for v in list(target_row)]
    except (TypeError, ValueError):
        return []
    if not values:
        return []
    peak = max((abs(v) for v in values), default=0.0)
    if peak <= 1e-9:
        return [False] * len(values)
    return [
        abs(v) >= COORDINATION_ABS_EPS and abs(v) >= COORDINATION_REL_RATIO * peak
        for v in values
    ]


def coordination_sample_weights(
    target: "torch.Tensor",
    coordination_weight: float = 0.5,
) -> "torch.Tensor":
    """Per-sample emphasis so combined motion dominates the training loss.

    A pure per-joint regression loss lets the model settle into a sequential
    shortcut (one joint, then the other): it reaches the same final pose, so
    the averaged error looks low while the gesture path is wrong. Boosting
    the weight of samples where several joints must move together makes that
    shortcut more expensive than the diagonal fit. Weighting never moves the
    optimum (every term is still zero at the exact fit), so single-joint and
    pose-only training are unaffected.
    """
    try:
        target_list = target.detach().cpu().tolist()
    except (AttributeError, RuntimeError, ValueError, TypeError):
        return torch.ones((target.shape[0],), dtype=torch.float32)
    if not target_list:
        return torch.ones((0,), dtype=torch.float32)
    try:
        boost = max(0.0, float(coordination_weight))
    except (TypeError, ValueError):
        boost = 0.0
    weights: list[float] = []
    for row in target_list:
        try:
            mask = expected_active_mask(row)
            multi = sum(1 for flag in mask if flag) >= 2
        except (TypeError, ValueError):
            multi = False
        weights.append(1.0 + boost if multi else 1.0)
    try:
        return torch.tensor(weights, dtype=torch.float32)
    except (TypeError, ValueError, RuntimeError):
        return torch.ones((len(weights),), dtype=torch.float32)


def coordination_diagnostics(
    prediction: "torch.Tensor",
    target: "torch.Tensor",
) -> dict[str, float]:
    """Direction alignment + simultaneity scores for training events.

    Pure observation (no gradients): mean cosine between predicted and target
    deltas, and the fraction of jointly-moving steps where every expected
    joint actually moved. Both are 1.0 when training only moves single
    joints or holds still.
    """
    try:
        target_list = target.detach().cpu().tolist()
        pred_list = prediction.detach().cpu().tolist()
    except (AttributeError, RuntimeError, ValueError, TypeError):
        return {"direction_alignment": 1.0, "simultaneity": 1.0, "multi_joint_fraction": 0.0}
    if not target_list:
        return {"direction_alignment": 1.0, "simultaneity": 1.0, "multi_joint_fraction": 0.0}
    cosines: list[float] = []
    sync_scores: list[float] = []
    multi_joint_steps = 0
    try:
        row_count = int(prediction.shape[0])
    except (TypeError, ValueError):
        return {"direction_alignment": 1.0, "simultaneity": 1.0, "multi_joint_fraction": 0.0}
    for row in range(row_count):
        try:
            tgt_vals = [float(v) for v in target_list[row]]
            prd_vals = [float(v) for v in pred_list[row]]
        except (TypeError, ValueError, IndexError):
            continue
        if math.sqrt(sum(v * v for v in tgt_vals)) <= 1e-9:
            continue
        cos = _cosine_similarity(tgt_vals, prd_vals)
        if cos is not None:
            cosines.append(cos)
        elif math.sqrt(sum(v * v for v in prd_vals)) <= 1e-12:
            cosines.append(-1.0)
        try:
            mask = expected_active_mask(target_list[row])
        except (TypeError, ValueError):
            mask = []
        active = [i for i, flag in enumerate(mask) if flag]
        if len(active) >= 2:
            multi_joint_steps += 1
            hits = 0
            for i in active:
                try:
                    t_val = float(target_list[row][i])
                    p_val = float(pred_list[row][i])
                except (TypeError, ValueError, IndexError):
                    continue
                if _coordination_hit(t_val, p_val):
                    hits += 1
            try:
                sync_scores.append(hits / max(1, len(active)))
            except (TypeError, ValueError, ZeroDivisionError):
                pass
    try:
        direction_alignment = float(sum(cosines) / len(cosines)) if cosines else 1.0
    except (TypeError, ValueError, ZeroDivisionError):
        direction_alignment = 1.0
    try:
        simultaneity = float(sum(sync_scores) / len(sync_scores)) if sync_scores else 1.0
    except (TypeError, ValueError, ZeroDivisionError):
        simultaneity = 1.0
    try:
        multi_joint_fraction = float(multi_joint_steps / max(1, row_count))
    except (TypeError, ValueError, ZeroDivisionError):
        multi_joint_fraction = 0.0
    return {
        "direction_alignment": direction_alignment,
        "simultaneity": simultaneity,
        "multi_joint_fraction": multi_joint_fraction,
    }


def analyze_rollout_coordination(
    gesture_frames: list[dict[str, Any]],
    joints: list[dict[str, Any]],
) -> dict[str, Any]:
    """Detect sequential (one-joint-at-a-time) execution in a rollout.

    Compares achieved per-step deltas against expected per-step deltas over
    gesture-phase frames. Returns simultaneity/direction scores plus a
    sequential flag so a low final-pose error can never hide a wrong path.
    """
    try:
        if len(gesture_frames) < 2:
            return {"simultaneity": 1.0, "direction_alignment": 1.0, "multi_joint_steps": 0, "sequential": False}
        expected = [list(f.get("expected", [])) for f in gesture_frames]
        achieved = [list(f.get("positions", [])) for f in gesture_frames]
        joint_count = len(joints) or (len(expected[0]) if expected else 0)
        if joint_count < 2:
            return {"simultaneity": 1.0, "direction_alignment": 1.0, "multi_joint_steps": 0, "sequential": False}
        exp_norm = [normalized(list(e), joints) if len(e) == joint_count else list(e) for e in expected]
        ach_norm = [normalized(list(a), joints) if len(a) == joint_count else list(a) for a in achieved]
        cosines: list[float] = []
        sync_scores: list[float] = []
        multi_joint_steps = 0
        for prev_e, curr_e, prev_a, curr_a in zip(exp_norm[:-1], exp_norm[1:], ach_norm[:-1], ach_norm[1:]):
            try:
                exp_delta = [c - p for p, c in zip(prev_e, curr_e)]
                ach_delta = [c - p for p, c in zip(prev_a, curr_a)]
            except (TypeError, ValueError):
                continue
            if math.sqrt(sum(v * v for v in exp_delta)) <= 1e-9:
                continue
            cos = _cosine_similarity(exp_delta, ach_delta)
            if cos is not None:
                cosines.append(cos)
            elif math.sqrt(sum(v * v for v in ach_delta)) <= 1e-12:
                cosines.append(-1.0)
            mask = expected_active_mask(exp_delta)
            active = [i for i, flag in enumerate(mask) if flag]
            if len(active) >= 2:
                multi_joint_steps += 1
                try:
                    hits = sum(1 for i in active if _coordination_hit(float(exp_delta[i]), float(ach_delta[i])))
                except (TypeError, ValueError, IndexError):
                    hits = 0
                try:
                    sync_scores.append(hits / max(1, len(active)))
                except (TypeError, ValueError, ZeroDivisionError):
                    pass
        try:
            simultaneity = float(sum(sync_scores) / len(sync_scores)) if sync_scores else 1.0
        except (TypeError, ValueError, ZeroDivisionError):
            simultaneity = 1.0
        try:
            direction = float(sum(cosines) / len(cosines)) if cosines else 1.0
        except (TypeError, ValueError, ZeroDivisionError):
            direction = 1.0
        sequential = bool(multi_joint_steps > 0 and (simultaneity < COORDINATION_SIMULTANEITY_THRESHOLD or direction < COORDINATION_DIRECTION_THRESHOLD))
        return {
            "simultaneity": simultaneity,
            "direction_alignment": direction,
            "multi_joint_steps": multi_joint_steps,
            "sequential": sequential,
        }
    except (TypeError, ValueError, AttributeError, IndexError, RuntimeError):
        return {"simultaneity": 1.0, "direction_alignment": 1.0, "multi_joint_steps": 0, "sequential": False}


# --- Gesture checkpoint probe (full-gesture fidelity) -----------------------
# Per-step training loss can stay low while an autoregressive replay misses
# interior checkpoints. Every gesture training run therefore ends with a cheap
# kinematic checkpoint probe, while the epoch budget remains user-controlled.

CHECKPOINT_MISS_MAE = 0.12


def probe_gesture_checkpoint_errors(
    model: torch.nn.Module,
    joints: list[dict[str, Any]],
    demonstration: Demonstration,
    step_ms: int,
) -> list[dict[str, Any]] | None:
    """Roll the model through the authored checkpoints kinematically.

    Compounding (autoregressive) execution without physics: the per-checkpoint
    MAE at its scheduled step is the honest "did it learn the full gesture"
    signal, unlike the teacher-forced per-step loss.
    """
    try:
        frames = authored_frames(demonstration)
        if len(frames) < 2:
            return None
        joint_count = len(joints)
        ordered = sorted(frames, key=lambda frame: frame.timestamp)
        step = max(1, int(step_ms))
        expected_size = model_expected_size(model, joint_count)
        current = list(ordered[0].positions)
        previous_delta = [0.0] * joint_count
        report: list[dict[str, Any]] = []
        for segment_index in range(len(ordered) - 1):
            end = ordered[segment_index + 1]
            duration = max(end.timestamp - ordered[segment_index].timestamp, step)
            steps = max(1, int(round(duration / step)))
            for index in range(steps):
                progress = min(1.0, (index + 1) / steps)
                current_normalized = normalized(current, joints)
                goal_normalized = normalized(end.positions, joints)
                features = build_features(current_normalized, goal_normalized, progress, previous_delta, expected_size)
                with torch.no_grad():
                    delta = model(features)[0].tolist()
                previous_delta = list(delta)
                current = denormalized([value + change for value, change in zip(current_normalized, delta)], joints)
            mae = sum(abs(a - b) for a, b in zip(current, end.positions)) / max(1, joint_count)
            report.append({"checkpoint": segment_index + 1, "timestamp": float(end.timestamp), "mae": float(mae)})
        return report
    except Exception:
        return None


def train_session(session: SimulationSession, request: TrainRequest) -> None:
    try:
        session.check_training_cancelled()
        if not request.demonstrations:
            raise ValueError("Capture at least one demonstration before training.")
        joint_count = len(session.joints)
        if any(len(item.current) != joint_count or len(item.target) != joint_count for item in request.demonstrations):
            raise ValueError("Each demonstration must contain one value per controllable joint.")
        torch.manual_seed(request.config.random_seed)
        # Generate samples at training timestep and, when timeline_fps is present,
        # also at grid (1000/fps) so rollout scaling (grid/step) is covered.
        has_fps = any(getattr(d, "timeline_fps", None) for d in request.demonstrations)
        if has_fps:
            base_samples = build_incremental_samples(request.demonstrations, session.joints, request.config.timestep_ms, request.config.random_starts, request.config.random_seed)
            grid_samples: list[dict[str, Any]] = []
            for demo in request.demonstrations:
                try:
                    fps_val = float(getattr(demo, "timeline_fps", 0) or 0)  # type: ignore[attr-defined]
                except Exception:
                    fps_val = 0
                if fps_val and fps_val > 0:
                    eff_step = max(10, min(int(round(1000.0 / fps_val)), 2000))
                    if eff_step != int(request.config.timestep_ms):
                        grid_samples.extend(build_incremental_samples([demo], session.joints, eff_step, request.config.random_starts, request.config.random_seed))
            if request.config.physics and session.body is not None:
                try:
                    base_samples = build_physics_feasible_samples(base_samples, session.joints, int(request.config.timestep_ms), session)
                except Exception as exc:
                    session.events.append({"type": "warning", "message": f"physics base fallback: {exc}"})
                # Grid samples use grid step for physics
                grid_phys: list[dict[str, Any]] = []
                for demo in request.demonstrations:
                    try:
                        fps_val = float(getattr(demo, "timeline_fps", 0) or 0)  # type: ignore[attr-defined]
                    except Exception:
                        fps_val = 0
                    if fps_val and fps_val > 0:
                        eff_step = max(10, min(int(round(1000.0 / fps_val)), 2000))
                        if eff_step != int(request.config.timestep_ms):
                            # Find grid samples for this demo (already generated) - regenerate for physics
                            demo_grid = build_incremental_samples([demo], session.joints, eff_step, request.config.random_starts, request.config.random_seed)
                            try:
                                demo_grid = build_physics_feasible_samples(demo_grid, session.joints, eff_step, session)
                            except Exception as exc:
                                session.events.append({"type": "warning", "message": f"Physics grid sampling failed for '{demo.name}' at {eff_step} ms; using kinematic targets: {exc}"})
                            grid_phys.extend(demo_grid)
                # Use base+grid_phys to avoid double-counting grid without physics
                samples = base_samples + grid_phys
                if samples:
                    session.events.append({"type": "training", "message": "physics-feasible samples enabled", "samples": len(samples)})
            else:
                samples = base_samples + grid_samples
        else:
            samples = build_incremental_samples(request.demonstrations, session.joints, request.config.timestep_ms, request.config.random_starts, request.config.random_seed)
            if request.config.physics and session.body is not None:
                try:
                    physics_samples = build_physics_feasible_samples(samples, session.joints, int(request.config.timestep_ms), session)
                    samples = physics_samples
                    session.events.append({"type": "training", "message": "physics-feasible samples enabled", "samples": len(samples)})
                except Exception as exc:
                    session.events.append({"type": "warning", "message": f"physics-feasible sampling fallback to kinematic: {exc}"})
        if request.config.physics and session.body is not None:
            for item in request.demonstrations:
                if item.kind != "gesture":
                    continue
                try:
                    frames = authored_frames(item)
                except Exception:
                    continue
                for finding in velocity_feasibility_findings(frames, session.joints):
                    session.events.append({"type": "warning", "message": finding["message"]})
        if not samples:
            raise ValueError("Capture at least two timeline checkpoints before training.")
        inputs = [
            sample["current"] + sample["goal"] + [sample["progress"]] + list(sample.get("previous_delta", [0.0] * joint_count))
            for sample in samples
        ]
        targets = [sample["delta"] for sample in samples]
        x = torch.tensor(inputs, dtype=torch.float32)
        y = torch.tensor(targets, dtype=torch.float32)
        model = make_model(expected_input_size(joint_count), joint_count, request.config)
        optimizer = torch.optim.Adam(model.parameters(), lr=request.config.learning_rate)
        loss_function = torch.nn.SmoothL1Loss(reduction="none")
        steps = request.config.epochs
        try:
            coordination_weight = float(request.config.coordination_weight)
        except Exception:
            coordination_weight = 0.5
        try:
            sample_weights = coordination_sample_weights(y, coordination_weight)
        except Exception:
            sample_weights = torch.ones((y.shape[0],), dtype=torch.float32)
        try:
            weight_sum = float(sample_weights.sum().item())
        except Exception:
            weight_sum = float(y.shape[0])
        if not weight_sum or weight_sum <= 0:
            weight_sum = float(y.shape[0])
        loss = torch.tensor(float("nan"))
        last_diagnostics: dict[str, float] = {"direction_alignment": 1.0, "simultaneity": 1.0, "multi_joint_fraction": 0.0}
        for epoch in range(steps):
            session.check_training_cancelled()
            prediction = model(x)
            # Weighted regression: samples where several joints must move
            # together count more, so the sequential shortcut (one joint,
            # then the other) costs more than the diagonal fit. Weighting
            # never moves the optimum (every term is still zero at the exact
            # fit), unlike additive penalty terms that fight fine-tuning.
            per_joint = loss_function(prediction, y)
            try:
                per_sample = per_joint.mean(dim=1)
                loss = (per_sample * sample_weights).sum() / weight_sum
            except Exception:
                loss = per_joint.mean()
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            try:
                with torch.no_grad():
                    last_diagnostics = coordination_diagnostics(model(x), y)
            except Exception:
                pass
            if epoch == 0 or (epoch + 1) % max(1, steps // 20) == 0 or epoch == steps - 1:
                try:
                    event_diagnostics = {key: float(value) for key, value in last_diagnostics.items()}
                except Exception:
                    event_diagnostics = {"direction_alignment": 1.0, "simultaneity": 1.0, "multi_joint_fraction": 0.0}
                try:
                    reported_loss = float(loss.item())
                except Exception:
                    reported_loss = float("nan")
                session.events.append({"type": "training", "epoch": epoch + 1, "epochs": steps, "loss": reported_loss, "samples": len(samples), **event_diagnostics})
        # Kinematic checkpoint probe — full-gesture signal beyond the per-step loss.
        checkpoint_probes: list[dict[str, Any]] = []
        for item in request.demonstrations:
            try:
                frames = authored_frames(item)
            except Exception:
                continue
            if item.kind != "gesture" or len(frames) < 2:
                continue
            fps_val = float(getattr(item, "timeline_fps", 0) or 0)
            probe_step = max(10, min(int(round(1000.0 / fps_val)), 2000)) if fps_val > 0 else max(1, int(request.config.timestep_ms))
            try:
                report = probe_gesture_checkpoint_errors(model, session.joints, item, probe_step)
            except Exception:
                report = None
            if not report:
                continue
            missed = [entry["checkpoint"] for entry in report if entry["mae"] > CHECKPOINT_MISS_MAE]
            probe_entry = {"demonstration": item.name, "checkpoints": report}
            if missed:
                probe_entry["missed"] = missed
            checkpoint_probes.append(probe_entry)
        with session.lock:
            session.check_training_cancelled()
            session.model = model.eval()
            session.model_config = request.config.model_dump()
            session.model_mode = "temporal"
            try:
                final_loss = float(loss.item())
            except Exception:
                final_loss = float("nan")
            try:
                final_diagnostics = {key: float(value) for key, value in last_diagnostics.items()}
            except Exception:
                final_diagnostics = {"direction_alignment": 1.0, "simultaneity": 1.0, "multi_joint_fraction": 0.0}
            session.events.append({"type": "training_complete", "loss": final_loss, "demonstrations": len(request.demonstrations), "samples": len(samples), "checkpoint_probe": checkpoint_probes, **final_diagnostics})
            for probe in checkpoint_probes:
                missed = probe.get("missed") or []
                if not missed:
                    continue
                details = ", ".join(
                    f"{entry['checkpoint']}:{entry['mae']:.3f}"
                    for entry in probe["checkpoints"]
                    if entry["checkpoint"] in missed
                )
                session.events.append({"type": "warning", "message": f"Gesture '{probe['demonstration']}' not fully learned: checkpoints {missed} missed (MAE > {CHECKPOINT_MISS_MAE}; {details}). The replay will skip those middle frames — try more epochs or check segment timing."})
    except Exception as exc:
        session.events.append({"type": "error", "message": str(exc)})
    finally:
        session.training = False
        if session.cancel_training.is_set():
            session.close()


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
    robot_id = hashlib.sha256(raw).hexdigest()
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
    try:
        gravity = None
        if request.gravity is not None:
            if len(request.gravity) != 3:
                raise ValueError("Gravity must have 3 components.")
            gravity = [float(v) for v in request.gravity]
            if not all(math.isfinite(v) for v in gravity):
                raise ValueError("Gravity components must be finite.")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    session = SimulationSession(session_id, robot, gravity=gravity, use_fixed_base=request.use_fixed_base)
    SESSIONS[session_id] = session
    return {"session_id": session_id, "robot": serializable_robot(robot), "state": session.state()}


@app.put("/api/sessions/{session_id}/demonstrations")
def save_demonstrations(session_id: str, request: DemonstrationsRequest) -> dict[str, Any]:
    session = active_session(session_id)
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


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str) -> dict[str, str]:
    session = active_session(session_id)
    if session is None:
        return {"status": "closed"}
    with session.lock:
        if session.training:
            raise HTTPException(409, "Cannot close a session while training is running.")
        SESSIONS.pop(session_id, None)
        session.close()
    return {"status": "closed"}


def expire_idle_sessions(now: float) -> None:
    for session_id, session in list(SESSIONS.items()):
        if not session.training and now - session.last_activity >= SESSION_IDLE_SECONDS:
            with session.lock:
                if not session.training and now - session.last_activity >= SESSION_IDLE_SECONDS:
                    SESSIONS.pop(session_id, None)
                    session.close()


async def reap_idle_sessions() -> None:
    while True:
        await asyncio.sleep(60)
        await asyncio.to_thread(expire_idle_sessions, time.monotonic())


@app.on_event("startup")
async def start_session_cleanup() -> None:
    app.state.session_cleanup = asyncio.create_task(reap_idle_sessions())


@app.put("/api/sessions/{session_id}/datasets")
def save_datasets(session_id: str, request: DatasetsRequest) -> dict[str, Any]:
    session = active_session(session_id)
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
    session = await asyncio.to_thread(active_session, session_id)
    if session is None:
        raise HTTPException(404, "Session not found.")
    if len(request.demonstrations) > MAX_DEMONSTRATIONS:
        raise HTTPException(413, f"A maximum of {MAX_DEMONSTRATIONS} demonstrations is supported.")
    try:
        await asyncio.to_thread(session.start_training, request)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"status": "started"}


@app.post("/api/sessions/{session_id}/predict")
def predict(session_id: str, request: PredictRequest) -> dict[str, Any]:
    session = active_session(session_id)
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
        expected_size = model_expected_size(session.model, len(session.joints))
        features = build_features(current_normalized, target_normalized, 1.0, [0.0] * len(session.joints), expected_size)
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
    session = active_session(session_id)
    if session is None:
        raise HTTPException(404, "Session not found.")
    with session.lock:
        session.last_activity = time.monotonic()
        return _rollout(session_id, request)


def _rollout(session_id: str, request: RolloutRequest) -> dict[str, Any]:
    session = active_session(session_id)
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
    saved_positions = list(session.positions)
    saved_gravity = list(session.gravity)
    if request.gravity is not None:
        try:
            if len(request.gravity) != 3:
                raise ValueError("Gravity must have 3 components.")
            session.set_gravity([float(v) for v in request.gravity])
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    use_physics = bool(request.physics) and session.body is not None
    try:
        if use_physics:
            try:
                session.set_positions(list(current))
            except ValueError:
                pass
        needs_approach = any(abs(a - b) > 1e-9 for a, b in zip(list(current), ordered[0].positions))
        result: list[dict[str, Any]] = [{"timestamp": 0, "positions": list(current), "expected": list(ordered[0].positions), "phase": "approach" if needs_approach else "gesture", "tracking_error": 0.0, "clipped": 0}]
        current_timestamp = 0
        total_steps = 0
        max_tracking_error = 0.0
        total_clipped = 0
        approach_start = list(current)
        if any(abs(a - b) > 1e-9 for a, b in zip(approach_start, ordered[0].positions)):
            if request.approach_mode == "scripted":
                for waypoint in build_approach_plan(approach_start, list(ordered[0].positions), session.joints, request.timestep_ms):
                    if total_steps >= request.max_steps:
                        break
                    current, entry_error, entry_clipped = _resolve_rollout_step(session, list(waypoint), request.timestep_ms, use_physics)
                    max_tracking_error = max(max_tracking_error, entry_error)
                    total_clipped += entry_clipped
                    current_timestamp += request.timestep_ms
                    result.append({"timestamp": current_timestamp, "positions": list(current), "expected": list(waypoint), "phase": "approach", "tracking_error": entry_error, "clipped": entry_clipped})
                    total_steps += 1
            else:
                approach_steps = approach_step_count(approach_start, list(ordered[0].positions), session.joints, request.timestep_ms)
                expected_size = model_expected_size(session.model, joint_count)
                previous_delta = [0.0] * joint_count
                for approach_index in range(approach_steps):
                    if total_steps >= request.max_steps:
                        break
                    progress = min(1.0, (approach_index + 1) / approach_steps)
                    current_normalized = normalized(current, session.joints)
                    target_normalized = normalized(ordered[0].positions, session.joints)
                    features = build_features(current_normalized, target_normalized, progress, previous_delta, expected_size)
                    with torch.no_grad():
                        delta = session.model(features)[0].tolist()
                    previous_delta = list(delta)
                    predicted = denormalized([value + change for value, change in zip(current_normalized, delta)], session.joints)
                    current, entry_error, entry_clipped = _resolve_rollout_step(session, predicted, request.timestep_ms, use_physics)
                    max_tracking_error = max(max_tracking_error, entry_error)
                    total_clipped += entry_clipped
                    current_timestamp += request.timestep_ms
                    expected = _lerp_positions(approach_start, ordered[0].positions, progress)
                    result.append({"timestamp": current_timestamp, "positions": list(current), "expected": expected, "phase": "approach", "tracking_error": entry_error, "clipped": entry_clipped})
                    total_steps += 1
        try:
            grid_ms = 1000.0 / request.timeline_fps if request.timeline_fps else float(request.timestep_ms)
            step_ms = int(request.timestep_ms)
            if step_ms < 1 or grid_ms < 1:
                raise ValueError("timing must be positive")
        except (TypeError, ValueError, ZeroDivisionError) as exc:
            raise HTTPException(422, f"Invalid timing parameter: {exc}") from exc
        # Canonical training step is grid when timeline_fps present
        canonical_step = int(round(grid_ms)) if request.timeline_fps else step_ms
        canonical_step = max(1, min(canonical_step, 2000))
        scale = grid_ms / canonical_step if request.timeline_fps else 1.0
        segment_ms_list = [ordered[i].timestamp - ordered[i-1].timestamp for i in range(1, len(ordered))]
        density = compute_rollout_density(segment_ms_list, grid_ms, request.max_steps, total_steps)
        raw_steps = density["scaled_steps"]
        # Keep raw for diagnostics, scaled is the budget-aware steps
        raw_steps_for_diag = density["raw_steps"]
        density_ratio = density["density_ratio"]
        # Build per-segment diagnostics for observability (no behavior change except via density module)
        segment_diagnostics = [
            {
                "segment_index": idx,
                "segment_ms": float(segment_ms_list[idx]),
                "raw_steps": int(raw_steps_for_diag[idx]),
                "scaled_steps": int(raw_steps[idx]),
                "effective_scale": float(compute_effective_scale(float(segment_ms_list[idx]), int(raw_steps[idx]), canonical_step, grid_ms)),
                "scale": float(compute_effective_scale(float(segment_ms_list[idx]), int(raw_steps[idx]), canonical_step, grid_ms)),
                "density_ratio": float(density_ratio),
                "grid_ms": float(grid_ms),
            }
            for idx in range(len(segment_ms_list))
        ]
        warning = check_budget_exhaustion(int(density["remaining"]), int(request.max_steps), float(density_ratio))
        warnings: list[dict[str, str]] = [warning] if warning else []
        # Physics feasibility: authored timing that exceeds joint velocity
        # limits cannot be hit on time by any model — say so instead of
        # letting a low error hide it.
        if use_physics:
            warnings.extend(velocity_feasibility_findings(ordered, session.joints))
        expected_size = model_expected_size(session.model, joint_count)
        # Carry previous_delta across gesture segments to avoid momentum loss at interior checkpoints
        rollout_prev_delta: list[float] = [0.0] * joint_count
        for checkpoint_index, segment_steps in zip(range(1, len(ordered)), raw_steps):
            checkpoint = ordered[checkpoint_index]
            prev_checkpoint = ordered[checkpoint_index - 1]
            # Decimation-aware scale per segment: when budget squeezes steps, per-step delta must grow
            segment_ms = float(prev_checkpoint.timestamp - checkpoint.timestamp) * -1.0 if checkpoint.timestamp < prev_checkpoint.timestamp else float(checkpoint.timestamp - prev_checkpoint.timestamp)
            # Use absolute segment duration
            try:
                segment_ms = abs(float(checkpoint.timestamp) - float(prev_checkpoint.timestamp))
            except Exception:
                segment_ms = float(ordered[checkpoint_index].timestamp - ordered[checkpoint_index - 1].timestamp)
            effective_scale = compute_effective_scale(segment_ms, segment_steps, canonical_step, grid_ms)
            is_step = False
            try:
                is_step = getattr(prev_checkpoint, "interpolation", "linear") == "step"
                # Also check if checkpoint carries interpolation (fallback)
                if not is_step:
                    is_step = getattr(checkpoint, "interpolation", None) == "step"
            except Exception:
                is_step = False
            for step_index in range(segment_steps):
                if total_steps >= request.max_steps:
                    break
                progress = min(1.0, (step_index + 1) / segment_steps)
                current_normalized = normalized(current, session.joints)
                target_normalized = normalized(checkpoint.positions, session.joints)
                features = build_features(current_normalized, target_normalized, progress, rollout_prev_delta, expected_size)
                with torch.no_grad():
                    delta = session.model(features)[0].tolist()
                scaled_delta = [value * effective_scale for value in delta]
                rollout_prev_delta = list(delta)
                predicted = denormalized([value + change for value, change in zip(current_normalized, scaled_delta)], session.joints)
                current, entry_error, entry_clipped = _resolve_rollout_step(session, predicted, int(grid_ms), use_physics)
                max_tracking_error = max(max_tracking_error, entry_error)
                total_clipped += entry_clipped
                current_timestamp += grid_ms
                if is_step:
                    expected = list(prev_checkpoint.positions) if progress < 1.0 else list(checkpoint.positions)
                else:
                    expected = _lerp_positions(
                        prev_checkpoint.positions,
                        checkpoint.positions,
                        progress,
                    )
                result.append({"timestamp": current_timestamp, "positions": list(current), "expected": expected, "phase": "gesture", "tracking_error": entry_error, "clipped": entry_clipped})
                total_steps += 1
            if total_steps >= request.max_steps:
                break
        if session.body is None:
            collisions = 0
        else:
            unique_contacts: set[tuple[int, int]] = set()
            saved_for_collision = list(session.positions)
            try:
                for frame in result:
                    try:
                        session.set_positions(list(frame["positions"]))
                        p.stepSimulation(physicsClientId=session.client)
                        contacts = p.getContactPoints(bodyA=session.body, physicsClientId=session.client)
                        for cp in contacts:
                            try:
                                link_a = int(cp[3]) if len(cp) > 3 else -1
                                link_b = int(cp[4]) if len(cp) > 4 else -1
                            except Exception:
                                continue
                            key = (link_a, link_b) if link_a <= link_b else (link_b, link_a)
                            unique_contacts.add(key)
                    except Exception:
                        continue
            finally:
                try:
                    session.set_positions(saved_for_collision)
                except Exception:
                    pass
            collisions = len(unique_contacts)
        try:
            gesture_only = [frame for frame in result if (frame.get("phase", "gesture") == "gesture")]
            coordination = analyze_rollout_coordination(gesture_only, session.joints)
        except Exception:
            coordination = {"simultaneity": 1.0, "direction_alignment": 1.0, "multi_joint_steps": 0, "sequential": False}
        try:
            if coordination.get("sequential"):
                warnings.append({
                    "type": "warning",
                    "message": (
                        "Sequential motion detected: joints moved one-at-a-time "
                        f"(simultaneity {float(coordination.get('simultaneity', 0.0)):.2f}, "
                        f"direction {float(coordination.get('direction_alignment', 0.0)):.2f}). "
                        "The gesture requires simultaneous multi-joint motion."
                    ),
                })
        except Exception:
            pass
        try:
            missed: list[int] = []
            try:
                gesture_hit = [f for f in result if f.get("phase") == "gesture"]
            except Exception:
                gesture_hit = []
            # Time-aligned check: for each checkpoint, find its segment-end frame (expected == checkpoint)
            # and measure achieved vs expected at that exact time, not "best ever" (brief hit would hide drift).
            # Build map from checkpoint index to its segment-end gesture frame error.
            # Gesture frames are ordered by segments; last frame of each segment has expected == checkpoint.
            # Handle decimation where a segment may have 0 steps -> use min-distance fallback for that cp.
            # First checkpoint is covered by initial result[0].
            checkpoint_errors: dict[int, float] = {}
            # Index tracker for gesture_hit segments
            # Reconstruct expected segment boundaries using raw_steps (scaled steps per segment)
            try:
                seg_pointer = 0
                for seg_idx, seg_steps in enumerate(raw_steps):
                    cp_idx = seg_idx + 1  # checkpoint index for this segment
                    if seg_steps <= 0:
                        # No steps for this segment -> will fallback to min-distance
                        continue
                    # Last frame of this segment is at seg_pointer + seg_steps -1 in gesture_hit
                    end_pos = min(seg_pointer + seg_steps - 1, len(gesture_hit) - 1)
                    if end_pos < 0:
                        seg_pointer += seg_steps
                        continue
                    gf = gesture_hit[end_pos]
                    try:
                        cp_pos = list(ordered[cp_idx].positions)
                        ach = list(gf.get("positions", []))
                        if len(ach) == len(cp_pos):
                            err = sum(abs(a - b) for a, b in zip(ach, cp_pos)) / max(1, len(cp_pos))
                            checkpoint_errors[cp_idx] = err
                        else:
                            checkpoint_errors[cp_idx] = float("inf")
                    except Exception:
                        checkpoint_errors[cp_idx] = float("inf")
                    seg_pointer += seg_steps
            except Exception:
                pass
            for idx_cp, cp in enumerate(ordered):
                try:
                    cp_pos = list(cp.positions)
                except Exception:
                    continue
                # Check time-aligned error if available, else fallback to min-distance
                aligned_err = checkpoint_errors.get(idx_cp, None)
                if aligned_err is not None:
                    best = aligned_err
                else:
                    # Fallback for cp 0 or segments with 0 steps: min distance
                    best = float("inf")
                    for gf in gesture_hit:
                        try:
                            ach = list(gf.get("positions", []))
                            if len(ach) != len(cp_pos):
                                continue
                            err = sum(abs(a - b) for a, b in zip(ach, cp_pos)) / max(1, len(cp_pos))
                            if err < best:
                                best = err
                        except Exception:
                            continue
                    if idx_cp == 0:
                        try:
                            init_err = sum(abs(a - b) for a, b in zip(list(result[0].get("positions", [])), cp_pos)) / max(1, len(cp_pos))
                            best = min(best, init_err)
                        except Exception:
                            pass
                if best == float("inf"):
                    continue
                if best > 0.12:
                    missed.append(idx_cp)
            if missed:
                interior = [i for i in missed if 0 < i < len(ordered) - 1]
                target_list = interior if interior else missed
                if target_list:
                    # Also include per-checkpoint errors for observability
                    details_parts: list[str] = []
                    for i in target_list:
                        if i in checkpoint_errors:
                            details_parts.append(f"{i}:{checkpoint_errors[i]:.3f}")
                        else:
                            details_parts.append(f"{i}:min")
                    details = ", ".join(details_parts)
                    warnings.append({"type": "warning", "message": f"Interior checkpoints missed: {target_list} (MAE >0.12). Detail {details}. Gesture not fully learned — increase epochs or check segment timing."})
        except Exception:
            pass
        return {"frames": result, "steps": total_steps, "collisions": collisions, "max_tracking_error": max_tracking_error, "clipped_steps": total_clipped, "physics": use_physics, "segment_diagnostics": segment_diagnostics, "density_ratio": density_ratio, "warnings": warnings, "coordination": coordination}
    finally:
        if request.gravity is not None:
            try:
                session.set_gravity(saved_gravity)
            except Exception:
                pass
        try:
            session.set_positions(saved_positions)
        except Exception:
            pass
@app.get("/api/sessions/{session_id}/export")
def export_session(session_id: str) -> StreamingResponse:
    session = active_session(session_id)
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
    session = await asyncio.to_thread(active_session, session_id)
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
                    await asyncio.to_thread(session.set_positions, message.get("positions", []))
                elif message_type == "reset":
                    await asyncio.to_thread(session.set_positions, [0.0] * len(session.joints))
                elif message_type == "step":
                    await asyncio.to_thread(session.step)
            except asyncio.TimeoutError:
                pass
            except ValueError as exc:
                await websocket.send_json({"type": "error", "message": str(exc)})
            await asyncio.to_thread(session.step)
            await websocket.send_json(await asyncio.to_thread(session.state))
            for event in session.events.drain():
                await websocket.send_json(event)
    except WebSocketDisconnect:
        return
    except Exception:
        return


@app.on_event("shutdown")
def shutdown() -> None:
    cleanup = getattr(app.state, "session_cleanup", None)
    if cleanup is not None:
        cleanup.cancel()
    sessions = list(SESSIONS.values())
    for session in sessions:
        session.cancel_training.set()
    for session in sessions:
        with session.lock:
            worker = session.training_thread
        if worker is not None:
            worker.join(timeout=5)
        # A worker still exiting owns final client cleanup in train_session.
        if worker is None or not worker.is_alive():
            session.close()
