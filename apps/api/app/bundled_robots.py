"""Trusted, vendored robot examples and their HTTP surface."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

ASSETS_DIR = Path(__file__).resolve().parent / "assets"
DEFAULT_ROBOT_EXAMPLE_ID = "unitree-g1-basic-23dof"
BUNDLED_ROBOT_EXAMPLES = {
    "unitree-g1-basic-23dof": {
        "name": "Unitree G1 Basic (23 DOF)",
        "description": "Official Unitree G1 mode 10 joint model, with primitive proxy geometry.",
        "filename": "g1_23dof_mode_10.source.urdf",
        "dof": 23,
    },
    "unitree-g1-edu-29dof": {
        "name": "Unitree G1 EDU (29 DOF)",
        "description": "Official Unitree G1 mode 11 joint model, with primitive proxy geometry.",
        "filename": "g1_29dof_mode_11.source.urdf",
        "dof": 29,
    },
}


def bundled_example_proxy(raw: bytes) -> bytes:
    """Replace vendored mesh references with safe, portable primitive proxies."""
    root = ET.fromstring(raw)
    for geometry in root.findall(".//geometry"):
        mesh = geometry.find("mesh")
        if mesh is None:
            continue
        geometry.remove(mesh)
        ET.SubElement(geometry, "box", {"size": "0.12 0.12 0.12"})
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def bundled_example_source(example_id: str) -> tuple[dict[str, Any], bytes]:
    example = BUNDLED_ROBOT_EXAMPLES.get(example_id)
    if example is None:
        raise KeyError(example_id)
    source_path = ASSETS_DIR / "unitree_g1" / str(example["filename"])
    return example, bundled_example_proxy(source_path.read_bytes())


def create_bundled_robot_router(
    load_example: Callable[[str], dict[str, Any]],
    serialize_robot: Callable[[dict[str, Any]], dict[str, Any]],
) -> APIRouter:
    router = APIRouter(prefix="/api/robots")

    @router.get("/examples")
    def robot_examples() -> list[dict[str, Any]]:
        return [
            {"id": example_id, **example}
            for example_id, example in BUNDLED_ROBOT_EXAMPLES.items()
        ]

    @router.get("/default")
    def default_robot() -> dict[str, Any]:
        return serialize_robot(load_example(DEFAULT_ROBOT_EXAMPLE_ID))

    @router.get("/examples/{example_id}")
    def robot_example(example_id: str) -> dict[str, Any]:
        try:
            robot = load_example(example_id)
        except KeyError as exc:
            raise HTTPException(404, "Robot example not found.") from exc
        return serialize_robot(robot)

    return router
