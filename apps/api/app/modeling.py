"""Declarative behavior-model specifications and their PyTorch compiler."""
from __future__ import annotations

from typing import Literal

import torch  # type: ignore[import-not-found]
from pydantic import BaseModel, Field  # type: ignore[import-not-found]


class DenseBlock(BaseModel):
    type: Literal["dense"] = "dense"
    width: int = Field(64, ge=1, le=512)
    activation: Literal["relu", "tanh", "gelu"] = "relu"


class ModelSpec(BaseModel):
    version: Literal[1] = 1
    family: Literal["mlp"] = "mlp"
    name: str = Field("Fast MLP", min_length=1, max_length=80)
    blocks: list[DenseBlock] = Field(
        default_factory=lambda: [DenseBlock(), DenseBlock()],
        min_length=1,
        max_length=8,
    )


def legacy_model_spec(hidden_layers: list[int], activation: str) -> ModelSpec:
    resolved_activation = activation if activation in {"relu", "tanh", "gelu"} else "relu"
    return ModelSpec(
        blocks=[
            DenseBlock(width=width, activation=resolved_activation)  # type: ignore[arg-type]
            for width in hidden_layers
        ]
    )


def compile_policy(
    input_size: int,
    output_size: int,
    spec: ModelSpec,
) -> torch.nn.Sequential:
    """Validate and compile one model specification into a behavior policy."""
    layers: list[torch.nn.Module] = []
    size = input_size
    activations: dict[str, type[torch.nn.Module]] = {
        "relu": torch.nn.ReLU,
        "tanh": torch.nn.Tanh,
        "gelu": torch.nn.GELU,
    }
    for block in spec.blocks:
        layers.extend(
            [
                torch.nn.Linear(size, block.width),
                activations[block.activation](),
            ]
        )
        size = block.width
    layers.append(torch.nn.Linear(size, output_size))
    return torch.nn.Sequential(*layers)


def parameter_count(input_size: int, output_size: int, spec: ModelSpec) -> int:
    return sum(parameter.numel() for parameter in compile_policy(input_size, output_size, spec).parameters())
