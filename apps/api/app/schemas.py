"""Validated transport and training contracts for the robot workbench.

Keeping these models outside route and runtime code makes the public request
contract discoverable without loading simulation, optimization, or HTTP logic.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

from .modeling import ModelSpec

MAX_EPOCHS = 5000
OPTIMIZATION_SCORE_NAME = "checkpoint_fidelity"
OPTIMIZATION_SCORE_VERSION = 1


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
    model_spec: ModelSpec | None = None


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
    source: Literal["camera"] | None = None
    camera_capture_id: str | None = None
    retargeting_profile: str | None = None
    retargeting_profile_version: Literal[1, 2] | None = None


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
    config: TrainConfig = Field(default_factory=TrainConfig)


class ExperimentSpecBase(BaseModel):
    version: Literal[1] = 1
    trial_epochs: int = Field(30, ge=5, le=300)
    score_name: Literal["checkpoint_fidelity"] = OPTIMIZATION_SCORE_NAME
    score_version: Literal[1] = OPTIMIZATION_SCORE_VERSION


class QuickExperimentSpec(ExperimentSpecBase):
    strategy: Literal["quick"] = "quick"
    trials: int = Field(6, ge=2, le=12)


class EvolutionSearchSpace(BaseModel):
    optimize_width: bool = True
    min_width: int = Field(16, ge=1, le=512)
    max_width: int = Field(256, ge=1, le=512)
    width_step: int = Field(16, ge=1, le=128)
    optimize_depth: bool = True
    min_depth: int = Field(1, ge=1, le=8)
    max_depth: int = Field(4, ge=1, le=8)
    activations: list[Literal["relu", "tanh", "gelu"]] = Field(default_factory=lambda: ["relu", "tanh", "gelu"], min_length=1)
    optimize_learning_rate: bool = True
    min_learning_rate: float = Field(0.0003, ge=0.000001, le=1.0)
    max_learning_rate: float = Field(0.01, ge=0.000001, le=1.0)

    def mutable_dimensions(self) -> list[str]:
        dimensions: list[str] = []
        if self.optimize_width and self.min_width < self.max_width:
            dimensions.append("width")
        if self.optimize_depth and self.min_depth < self.max_depth:
            dimensions.append("depth")
        if len(self.activations) > 1:
            dimensions.append("activation")
        if self.optimize_learning_rate and self.min_learning_rate < self.max_learning_rate:
            dimensions.append("learning_rate")
        return dimensions

    @model_validator(mode="after")
    def valid_ranges(self) -> "EvolutionSearchSpace":
        if self.min_width > self.max_width:
            raise ValueError("Minimum width cannot exceed maximum width.")
        if self.min_depth > self.max_depth:
            raise ValueError("Minimum depth cannot exceed maximum depth.")
        if self.min_learning_rate > self.max_learning_rate:
            raise ValueError("Minimum learning rate cannot exceed maximum learning rate.")
        if not self.mutable_dimensions():
            raise ValueError("Evolution search must vary at least one parameter.")
        return self


class EvolutionExperimentSpec(ExperimentSpecBase):
    strategy: Literal["evolution"]
    population_size: int = Field(4, ge=2, le=8)
    generations: int = Field(3, ge=2, le=8)
    mutation_rate: float = Field(0.35, ge=0.05, le=1.0)
    search_space: EvolutionSearchSpace = Field(default_factory=EvolutionSearchSpace)

    @model_validator(mode="after")
    def bounded_search_budget(self) -> "EvolutionExperimentSpec":
        if self.population_size * self.generations > 48:
            raise ValueError("Evolution search is limited to 48 candidate fits.")
        return self


ExperimentSpec = Annotated[QuickExperimentSpec | EvolutionExperimentSpec, Field(discriminator="strategy")]


class OptimizeRequest(BaseModel):
    demonstrations: list[Demonstration]
    config: TrainConfig = Field(default_factory=TrainConfig)
    experiment: ExperimentSpec = Field(default_factory=QuickExperimentSpec)

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_quick_experiment(cls, value: Any) -> Any:
        if isinstance(value, dict) and isinstance(value.get("experiment"), dict):
            experiment = value["experiment"]
            if "strategy" not in experiment:
                value = {**value, "experiment": {**experiment, "strategy": "quick"}}
        return value


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
