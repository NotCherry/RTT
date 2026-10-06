"""Preparation-only contract: validates a DDS plan without creating a publisher."""
from typing import Literal
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(prefix="/api/robot-transport", tags=["robot-transport"])


class DDSConnectionPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    transport: Literal["unitree-sdk2", "ros2"] = "unitree-sdk2"
    network_interface: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_.:-]+$")
    domain_id: int = Field(default=0, ge=0, le=232)
    robot_model: Literal["g1-29"] = "g1-29"
    max_joint_speed: float = Field(default=0.5, gt=0, le=0.5, allow_inf_nan=False)
    stale_after_ms: int = Field(default=250, ge=50, le=250)


@router.post("/plan")
def plan_connection(plan: DDSConnectionPlan):
    return {
        "config": plan.model_dump(),
        "transmission_enabled": False,
        "command_topic": "rt/arm_sdk" if plan.transport == "unitree-sdk2" else "arm_sdk",
        "state_topic": "rt/lowstate" if plan.transport == "unitree-sdk2" else "lowstate",
        "command_type": "unitree_hg/LowCmd",
        "requires_robot_ip": False,
        "required_before_activation": [
            "verified single robot on isolated DDS network",
            "fresh measured joint state and verified motor index map",
            "backend speed and acceleration limits with watchdog",
            "explicit arm authorization and local emergency stop",
        ],
    }
