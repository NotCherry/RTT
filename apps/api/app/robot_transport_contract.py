from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .robot_motion import ARM_INDICES


class DDSConnectionPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    transport: Literal["unitree-sdk2", "ros2"] = "unitree-sdk2"
    network_interface: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_.:-]+$")
    domain_id: int = Field(default=0, ge=0, le=232)
    robot_model: Literal["g1-29", "g1-23"] = "g1-29"
    max_joint_speed: float = Field(default=1, gt=0, le=3, allow_inf_nan=False)
    max_joint_acceleration: float = Field(default=3, gt=0, le=10, allow_inf_nan=False)
    stale_after_ms: int = Field(default=250, ge=50, le=250)


class ConnectionConfig(DDSConnectionPlan):
    transport: Literal["unitree-sdk2", "mock"] = "mock"
    kp: float = Field(default=20, ge=5, le=80, allow_inf_nan=False)
    kd: float = Field(default=1.5, ge=0.1, le=5, allow_inf_nan=False)


class TargetPacket(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sequence: int = Field(ge=0)
    sent_at_ms: float = Field(ge=0, allow_inf_nan=False)
    tracking: bool
    positions: dict[str, float] = Field(default_factory=dict, max_length=14)

    @model_validator(mode="after")
    def validate_positions(self):
        import math
        if any(name not in ARM_INDICES or not math.isfinite(q) for name, q in self.positions.items()):
            raise ValueError("Only finite, named G1 arm positions are accepted")
        return self
