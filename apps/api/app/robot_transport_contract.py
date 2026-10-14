from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from .robot_motion import UPPER_BODY_INDICES


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
    transport: Literal["unitree-sdk2", "unitree-rosbridge", "mock"] = "mock"
    kp: float = Field(default=20, ge=5, le=80, allow_inf_nan=False)
    kd: float = Field(default=1.5, ge=0.1, le=5, allow_inf_nan=False)
    control_mode: Literal["arms", "single-arm", "upper-body"] = "arms"
    active_arm: Literal["left", "right"] = "right"
    waist_dof: Literal[1, 3] = 1
    waist_kp: float = Field(default=40, ge=5, le=80, allow_inf_nan=False)
    waist_kd: float = Field(default=2, ge=0.1, le=5, allow_inf_nan=False)
    discovery_peers: list[str] = Field(default_factory=list, max_length=16)
    allow_multicast: bool = True
    rosbridge_url: str | None = Field(default=None, max_length=512)

    @field_validator("discovery_peers")
    @classmethod
    def validate_discovery_peers(cls, peers):
        from ipaddress import IPv4Address
        return list(dict.fromkeys(str(IPv4Address(peer)) for peer in peers))

    @model_validator(mode="after")
    def validate_bridge(self):
        if self.robot_model == "g1-23" and self.waist_dof != 1:
            raise ValueError("G1 23 DOF supports waist yaw only")
        if self.transport == "unitree-rosbridge":
            from urllib.parse import urlsplit
            address = urlsplit(self.rosbridge_url or "")
            if address.scheme not in ("ws", "wss") or not address.hostname or address.username or address.password:
                raise ValueError("Unitree ROS bridge requires a ws:// or wss:// URL without embedded credentials")
        elif self.rosbridge_url is not None:
            raise ValueError("rosbridge_url is only used with unitree-rosbridge")
        return self


class TargetPacket(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sequence: int = Field(ge=0)
    sent_at_ms: float = Field(ge=0, allow_inf_nan=False)
    tracking: bool
    positions: dict[str, float] = Field(default_factory=dict, max_length=17)
    reference: dict[str, float] = Field(default_factory=dict, max_length=17)
    observation_age_ms: float | None = Field(default=None, ge=0, le=250, allow_inf_nan=False)
    processing_ms: float | None = Field(default=None, ge=0, le=250, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_positions(self):
        import math
        if any(name not in UPPER_BODY_INDICES or not math.isfinite(q) for values in (self.positions, self.reference) for name, q in values.items()):
            raise ValueError("Only finite, named G1 upper-body positions are accepted")
        return self
