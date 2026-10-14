"""Camera-only calibration API; no remote URL fetching or robot commands."""
import asyncio
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .camera_calibration_worker import isolated_calibration

router = APIRouter(prefix="/api/camera-calibration", tags=["camera calibration"])
worker_slots = asyncio.Semaphore(1)


class Board(BaseModel):
    model_config = ConfigDict(extra="forbid")
    columns: int = Field(default=10, ge=5, le=10)
    rows: int = Field(default=7, ge=5, le=7)
    square_m: float = Field(default=.025, ge=.01, le=.2, allow_inf_nan=False)
    marker_m: float = Field(default=.018, ge=.005, le=.15, allow_inf_nan=False)

    @model_validator(mode="after")
    def marker_fits(self):
        if self.marker_m >= self.square_m:
            raise ValueError("Marker must be smaller than its square")
        return self


class ImageView(BaseModel):
    id: Literal["view-1", "view-2", "view-3"]
    jpeg: str = Field(max_length=2_000_000, min_length=1)


class DetectionRequest(BaseModel):
    board: Board
    views: list[ImageView] = Field(min_length=2, max_length=3)


class CornerView(BaseModel):
    id: Literal["view-1", "view-2", "view-3"]
    width: int = Field(ge=1, le=4096)
    height: int = Field(ge=1, le=4096)
    ids: list[int] = Field(min_length=12, max_length=54)
    points: list[tuple[float, float]] = Field(min_length=12, max_length=54)

    @model_validator(mode="after")
    def valid_points(self):
        import math
        if len(self.ids) != len(self.points) or len(set(self.ids)) != len(self.ids) or any(i < 0 or i >= 54 for i in self.ids):
            raise ValueError("Invalid board corner correspondence")
        if any(not all(math.isfinite(p) for p in point) or not (0 <= point[0] < self.width and 0 <= point[1] < self.height) for point in self.points):
            raise ValueError("Board corners must be inside the camera image")
        return self


class SolveRequest(BaseModel):
    board: Board
    observations: list[list[CornerView]] = Field(min_length=14, max_length=60)

    @model_validator(mode="after")
    def common_views(self):
        expected = [v.id for v in self.observations[0]]
        if expected not in (["view-1", "view-2"], ["view-1", "view-2", "view-3"]):
            raise ValueError("Select two or three ordered camera views")
        if any([v.id for v in sample] != expected for sample in self.observations):
            raise ValueError("Camera identities changed during calibration")
        maximum_id = (self.board.columns - 1) * (self.board.rows - 1)
        if any(i >= maximum_id for sample in self.observations for v in sample for i in v.ids):
            raise ValueError("Corner ID does not belong to this board")
        return self


async def run_worker(operation, payload):
    if worker_slots.locked():
        raise HTTPException(409, "Calibration worker is busy; retry after the current operation")
    async with worker_slots:
        # Cancellation does not release the slot until the child is reaped.
        work = asyncio.create_task(asyncio.to_thread(isolated_calibration, operation, payload))
        try:
            return await asyncio.shield(work)
        except asyncio.CancelledError:
            await work
            raise
        except TimeoutError as error:
            raise HTTPException(504, str(error)) from error
        except (ValueError, EOFError) as error:
            raise HTTPException(422, str(error)) from error


@router.post("/board")
async def board_image(board: Board):
    return await run_worker("board", {"board": board.model_dump()})


@router.post("/detect")
async def detect_board(request: DetectionRequest):
    if [v.id for v in request.views] not in (["view-1", "view-2"], ["view-1", "view-2", "view-3"]):
        raise HTTPException(422, "Select two or three ordered camera views")
    return await run_worker("detect", request.model_dump())


@router.post("/solve")
async def solve_board(request: SolveRequest):
    return await run_worker("solve", request.model_dump())
