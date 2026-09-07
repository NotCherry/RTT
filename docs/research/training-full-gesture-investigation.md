# Training Full-Gesture Investigation — Does Training Use All Keyframes or Only Endpoints?

> Research note per `research` skill. Primary sources only — each factual claim cited by file path + line numbers. No secondary write-ups.

**Date:** 2026-09-07
**Question:** User reports training “only first and last frames are taken into consideration” and wants the robot to learn the full gesture with as many keyframes as designed, without skipping planned tasks/improvements. Verify against primary code whether the current pipeline actually uses all intermediate keyframes or only endpoints, and identify what a redesign would need.

---

## 1. Summary

**Verdict: The current code *does* iterate over all segments between authored checkpoints — it does not deliberately collapse to first+last only.**

- `authored_frames()` prefers `keyframes` over `frames` but preserves all entries sorted by `frame` — not just two endpoints.
- `build_incremental_samples()` loops `for segment_index in range(len(route) - 1)` and expands *each* segment into per-step delta samples via `_lerp_positions`. The tail partial interval (e.g., 50 ms of a 250 ms segment at 100 ms step) gets its own sample with `progress=1.0`.
- The frontend mirror `buildIncrementalSamples` in `timeline.ts` has identical per-segment logic.
- `train_session()` has a `has_fps` path that *duplicates* samples (base timestep + grid-timestep) — it does not drop intermediates, but it doubles counting when `timeline_fps` is present.
- The rollout path *does* preserve intermediate checkpoints as separate goals (`target_normalized = checkpoint.positions` per segment) and computes `segment_diagnostics` per segment. **However, it can sparsify per-segment steps under a `max_steps` budget** via `compute_rollout_density`, and scales deltas via `compute_effective_scale`. This is a decimation path the user could perceive as “skipping” intermediate shape.

**Why the user still sees first/last-only:** six plausible causes survive even with correct sampling — `start_frame_index` slicing, `progress` conditioning reset at segment start, random-starts approach dilution, physics servo clipping, autoregressive compounding drift, and grid-vs-timestep scaling mismatch. Any one can make intermediate waypoints not “stick” even though they were trained on.

Primary sources: `apps/api/app/main.py`, `apps/web/src/domain/timeline.ts`, `apps/web/src/types.ts`, `CONTEXT.md`, `apps/api/tests/test_main.py`, `AGENTS.md`.

---

## 2. Terminology (per CONTEXT.md)

Source: `CONTEXT.md:1-72` (read 2026-09-07).

| Term | Canonical definition |
|------|----------------------|
| **Frame** | A timestamped robot state captured as one point in an expected behavior. Not a prediction or training sample. |
| **Checkpoint** | An authored Keyframe in the gesture timeline — complete controllable-joint state at a deliberate timeline frame; motion *between* checkpoints is derived for preview, training, and evaluation. |
| **Keyframe** | An authored time-position pair; appears as selectable channel markers and is source of truth. Derived timestep samples are *never* promoted to keyframes. |
| **Gesture** | Ordered sequence of frames describing motion over time. |
| **Demonstration** | Recorded pose or gesture expressing expected behavior, archived or used for training. Kind `"pose"` or `"gesture"`. |
| **Training run** | One attempt to derive a behavior model from archived demonstrations, including config and progress metrics. |
| **Evaluation** | Deliberate inspection of how trained model reproduces expected demonstration. |
| **Prediction** | Model-produced state/action for an evaluation case. |
| **Physics-realistic replay** | Execution via PyBullet `POSITION_CONTROL` + `stepSimulation` substeps + `getJointState` read-back, reflecting mass/gravity/effort/velocity/contact. |
| **Coordination / Coordination weight** | Simultaneous multi-joint motion vs sequential L-shape; `coordination_weight` emphasizes training samples where several joints must move together. Stays MLP-simple. |

Notes for this doc: “Intermediate keyframe” = any checkpoint that is neither first nor last. “Endpoints” = first and last checkpoint. “Derived sample” = a per-step `(current, next, delta, progress, goal)` produced by interpolation between two checkpoints.

---

## 3. Current Pipeline (with code citations)

### 3.1 Data models — Demonstration / Keyframe / DemonstrationFrame

Source: `apps/api/app/main.py:354-387`

```python
class DemonstrationFrame(BaseModel): # :354-357
    timestamp: float = Field(ge=0)
    positions: list[float]

class Keyframe(BaseModel): # :359-365
    id: str
    frame: int = Field(ge=0)
    timestamp: float = Field(ge=0)
    positions: list[float]
    interpolation: Literal["linear", "step"] = "linear"

class Demonstration(BaseModel): # :367-387
    id: str
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
```

Frontend mirror — Source: `apps/web/src/types.ts:13-33`

```ts
export type DemonstrationFrame = { timestamp: number; positions: number[] };        // :13-17
export type Keyframe = { id: string; frame: number; timestamp: number;             // :18-25
  positions: number[]; interpolation: KeyframeInterpolation }
export type Demonstration = { id: string; name: string; kind: "pose"|"gesture";    // :26-39
  current: number[]; target: number[]; frames: DemonstrationFrame[];
  keyframes?: Keyframe[]; timeline_fps?: number; duration_frames?: number;
  start_frame_index?: number }
```

Key points:

- `current`/`target` are legacy pose fields still present on every `Demonstration`. They are the fallback when `frames` is empty (see §3.3). They do **not** replace multi-frame handling when checkpoints exist.
- `keyframes` is optional; when absent, `frames` is used. No code path merges both — it is `keyframes` *or* `frames`.

### 3.2 authored_frames() — keyframes vs frames precedence

Source: `apps/api/app/main.py:862-870`

```python
def authored_frames(demonstration: Demonstration) -> list[DemonstrationFrame]: # :862
    if demonstration.keyframes:                                                # :863
        return [                                                               # :864
            DemonstrationFrame(timestamp=keyframe.timestamp,                   # :865
                               positions=keyframe.positions)                   # :865
            for keyframe in sorted(demonstration.keyframes,                  # :866
                                   key=lambda item: item.frame)               # :866
        ]
    return sorted(demonstration.frames, key=lambda frame: frame.timestamp)    # :869
```

- If `keyframes` non-empty, **all** keyframes sorted by `frame` are returned. No slice to `[0, -1]`.
- If `keyframes` empty, `frames` sorted by `timestamp` are returned. Again all entries.
- Not cited: the function ignores `Keyframe.interpolation` (always linear `_lerp_positions`). No `step` handling in backend — frontend also hard-codes `"linear"` in `framesToKeyframes`.

### 3.3 build_incremental_samples() — the training sample expander

Source: `apps/api/app/main.py:925-1010`

Signature & guards — Source: `apps/api/app/main.py:925-935`

```python
def build_incremental_samples(                # :925
    demonstrations: list[Demonstration],      # :926
    joints: list[dict[str, Any]],            # :927
    timestep_ms: int,                        # :928
    random_starts: int = 0,                  # :929
    random_seed: int = 7,                    # :930
) -> list[dict[str, Any]]:                  # :931
    """Expand authored checkpoints into small next-state delta samples.""" # :932
    if timestep_ms < 1:                      # :933
        raise ValueError("The training timestep must be positive.")        # :934
```

Route construction — Source: `apps/api/app/main.py:940-952`

```python
        frames = authored_frames(demonstration)              # :940
        if not frames:                                       # :941
            frames = [DemonstrationFrame(timestamp=0,        # :942
                      positions=demonstration.target)]       # :942
        start_index = min(demonstration.start_frame_index,   # :943
                          len(frames) - 1)                   # :943
        frames = frames[start_index:]                        # :944  <-- slicing
        if len(frames) == 1:                                 # :946
            frames = [                                       # :947
                DemonstrationFrame(timestamp=0,               # :948
                    positions=demonstration.current),         # :948
                DemonstrationFrame(timestamp=step,            # :949
                    positions=frames[0].positions),          # :949
            ]
```

- `start_frame_index` slicing **does** drop leading checkpoints before the chosen start. This is intentional (timeline “start from here”) but is a user-visible “skipping” source — see §6.1.
- Single-frame fallback fabricates a 2-frame gesture `current → target`. This is the *only* place endpoints alone are synthesized, and only when the demonstration truly has 0 or 1 authored checkpoint. Source: `apps/api/app/main.py:946-951`.

Core per-segment loop — Source: `apps/api/app/main.py:980-1003`

```python
            route = frames                                   # :980
            for segment_index in range(len(route) - 1):      # :981  <-- all segments
                segment_start = route[segment_index]         # :982
                segment_end = route[segment_index + 1]       # :983
                duration = max(segment_end.timestamp -       # :984
                               segment_start.timestamp, step) # :984
                previous_delta = [0.0] * joint_count        # :987
                for elapsed in np.arange(0, duration, step): # :988
                    progress = min(1.0, elapsed / duration) # :989
                    next_progress = min(1.0,                 # :990
                        (elapsed + step) / duration)         # :990
                    current = _lerp_positions(               # :991
                        segment_start.positions,             # :991
                        segment_end.positions, progress)      # :991
                    next_state = _lerp_positions(            # :992
                        segment_start.positions,             # :992
                        segment_end.positions, next_progress) # :992
                    current_normalized = normalized(current, joints)   # :993
                    next_normalized = normalized(next_state, joints)   # :994
                    delta = [next_value - current_value     # :995
                             for next_value, current_value   # :995
                             in zip(next_normalized,         # :995
                                    current_normalized)]     # :995
                    samples.append({                         # :996
                        "current": current_normalized,       # :997
                        "goal": normalized(segment_end.positions, joints), # :998
                        "progress": next_progress,           # :999
                        "previous_delta": list(previous_delta), # :1000
                        "delta": delta,                      # :1001
                    })
```

Findings:

- Iterates `len(route) - 1` segments — **all** adjacent checkpoint pairs, not just `route[0]→route[-1]`.
- `duration = max(end.timestamp - start.timestamp, step)` guards zero/tiny durations; `np.arange(0, duration, step)` plus tail handling via `min(elapsed+step, end)` emits the final partial interval. Tail sample test proves this — Source: `apps/api/tests/test_main.py:340-366` (see §5.2).
- Per-sample `goal` is **segment_end**, not final gesture end. So the model learns “move toward the next checkpoint,” not “jump to final pose.” Whether that conditions as segment-relative or gesture-relative matters for redesign (§7).
- `progress` is **segment-local** (`elapsed/duration` within the segment) and resets to 0 at each segment start. This is a design choice, not a bug, but it is a cause of first/last perception (§6.2).
- `_lerp_positions` — Source: `apps/api/app/main.py:740-745` — is a pure linear blend; no `step` interpolation, no per-joint easing. Frontend `interpolatePositions` is identical — Source: `apps/web/src/domain/timeline.ts:134-160`.

Frontend mirror — Source: `apps/web/src/domain/timeline.ts:188-231`

```ts
export function buildIncrementalSamples(       // :188
  frames: DemonstrationFrame[], stepMs = 120  // :189
): IncrementalSample[] {                      // :188
  for (let segmentIndex = 0;                 // :194
       segmentIndex < ordered.length - 1;    // :194
       segmentIndex += 1) {                  // :194
    const start = ordered[segmentIndex];     // :196
    const end = ordered[segmentIndex + 1];   // :197
    const duration = Math.max(              // :198
      end.timestamp - start.timestamp, step);// :198
    for (let elapsed = 0;                   // :199
         elapsed < duration; elapsed += step){// :199
      // ... interpolatePositions + delta   // :201-209
    }
  }
}
```

Identical segment logic; front-end also uses all segments.

`_interpolate_frame_positions` used elsewhere (diagnostics) — Source: `apps/api/app/main.py:846-860` — also does full-route interpolation via `ordered.findIndex` + `_lerp_positions`.

Random-starts dilution — Source: `apps/api/app/main.py:955-979`

For each extra `random_starts` seed, the code builds a scripted `approach` from a random joint pose to `frames[0].positions` via `build_approach_plan`, emitting `approach_step_count` samples with `goal=frames[0]`. These approach samples are concatenated *before* the gesture segments. With `random_starts=4` (default `TrainConfig.random_starts: 4` — Source: `apps/api/app/main.py:330`) this can add many approach samples that may dominate loss if gesture has few steps — see §6.4.

### 3.4 train_session() — has_fps / grid_samples duplication

Source: `apps/api/app/main.py:1261-1360`

```python
def train_session(session: SimulationSession,  # :1261
                  request: TrainRequest) -> None: # :1261
    has_fps = any(getattr(d, "timeline_fps", None)  # :1272
                  for d in request.demonstrations) # :1272
    if has_fps:                                   # :1273
        base_samples = build_incremental_samples(  # :1273
            request.demonstrations, session.joints, # :1273
            request.config.timestep_ms,             # :1273
            request.config.random_starts,           # :1273
            request.config.random_seed)             # :1273
        grid_samples: list[dict[str, Any]] = []   # :1274
        for demo in request.demonstrations:       # :1275
            fps_val = float(getattr(demo, "timeline_fps", 0) or 0) # :1277
            if fps_val and fps_val > 0:           # :1279
                eff_step = max(10,                 # :1280
                    min(int(round(1000.0 / fps_val)), 2000)) # :1280
                if eff_step != int(request.config.timestep_ms): # :1281
                    grid_samples.extend(          # :1282
                        build_incremental_samples([demo], # :1282
                          session.joints, eff_step, # :1282
                          request.config.random_starts, # :1282
                          request.config.random_seed)) # :1282
```

Second half (physics correction) — Source: `apps/api/app/main.py:1284-1312`

- When `physics=True`, both `base_samples` and each `demo_grid` are passed through `build_physics_feasible_samples` (Source: `apps/api/app/main.py:871-922`) separately, then concatenated as `samples = base_samples + grid_phys`. Without physics, `samples = base_samples + grid_samples`.
- When `has_fps` is False, only `build_incremental_samples(..., timestep_ms)` is used (Source: `apps/api/app/main.py:1313-1316`).

Implications:

- **Does it drop intermediates? No.** Both `base_samples` and `grid_samples` are built with the same per-segment logic, so intermediates are present in both sets.
- **Does it duplicate? Yes, by design.** If `timeline_fps=30` → `eff_step=33 ms` and `timestep_ms=120`, every demonstration yields two full sample expansions (one at 120 ms, one at 33 ms). This inflates dataset size ~2×–4× and biases loss toward demonstrations that have a `timeline_fps`. Samples are not deduplicated.
- Physics correction mutates `previous_delta` to the corrected delta of the prior step (Source: `apps/api/app/main.py:880-890`) but skips zero entries (segment boundaries). This is intentionally history-aware but still per-segment.

Coordination weighting — Source: `apps/api/app/main.py:1339-1355`

The training loop computes `per_sample = per_joint.mean(dim=1)` then `loss = (per_sample * sample_weights).sum() / weight_sum` where `sample_weights` is `1.0 + coordination_weight` for multi-joint steps (Source: `apps/api/app/main.py:1089-1119`). This emphasizes intermediate diagonal segments but does not change segment coverage. Weighting “never moves the optimum (every term is still zero at exact fit)” — Source: `apps/api/app/main.py:1104-1107`.

### 3.5 Rollout path — density, effective_scale, segment diagnostics

Rollout request — Source: `apps/api/app/main.py:396-421` (`RolloutRequest`) and `apps/api/app/main.py:1557-1700` (`rollout()` function).

Budget modules — Source: `apps/api/app/main.py:747-844`

```python
class RolloutBudget(BaseModel):               # :748
    segment_ms_list: list[float]             # :749
    grid_ms: float                            # :750
    max_steps: int                            # :751
    total_steps: int                          # :752

def _compute_rollout_density_bundled(...) -> dict[str, Any]: # :763
    raw_steps = [max(1, math.ceil(max(seg_ms, budget.grid_ms)  # :764
                   / budget.grid_ms)) for seg_ms in budget.segment_ms_list] # :764
    remaining = max(0, budget.max_steps - budget.total_steps) # :765
    if sum(raw_steps) > remaining:            # :766
        scaled = [math.floor(steps * remaining / sum(raw_steps)) ...] # :767
        leftover = remaining - sum(scaled)    # :768
        largest_first = sorted(range(len(raw_steps)), # :769
                        key=lambda i: raw_steps[i], reverse=True) # :769
        while leftover > 0 and largest_first: # :771
            scaled[largest_first[idx % len(largest_first)]] += 1 # :772
        scaled_steps = scaled                 # :773
    else:
        scaled_steps = list(raw_steps)        # :776
    density_ratio = sum(raw_steps) / max(1, sum(scaled_steps)) # :777

def compute_rollout_density(segment_ms_list, grid_ms, # :788
                            max_steps, total_steps) -> dict[str, Any]: # :788
    return _compute_rollout_density_bundled(...) # :800
```

Effective scale — Source: `apps/api/app/main.py:804-828`

```python
def _compute_effective_scale_bundled(params: SegmentScaleParams) -> float: # :804
    if params.segment_steps <= 0 or params.step_ms <= 0: # :805
        return 1.0                           # :806
    effective_ms_per_step = float(params.segment_ms)  # :808
                          / float(params.segment_steps) # :808
    scale = effective_ms_per_step / float(params.step_ms) # :809
    return float(scale)                    # :811

def compute_effective_scale(segment_ms, segment_steps, # :817
                            step_ms, grid_ms) -> float: # :817
    return _compute_effective_scale_bundled(...) # :824
```

Exhaustion warning — Source: `apps/api/app/main.py:829-845`

```python
def check_budget_exhaustion(remaining, max_steps, density_ratio=None): # :829
    if remaining == 0 and max_steps > 0:     # :832
        return {"type": "warning",           # :833
          "message": f"Gesture trimmed: approach consumed max_steps ..."} # :834
    if density_ratio is not None and density_ratio > 1.01: # :835
        return {"type": "warning",           # :836
          "message": f"Gesture decimated: density {density_ratio:.2f}x ..."} # :837
```

Rollout usage — Source: `apps/api/app/main.py:1638-1683`

```python
        segment_ms_list = [ordered[i].timestamp - # :1639
                           ordered[i-1].timestamp ...] # :1639
        density = compute_rollout_density(segment_ms_list, # :1640
                    grid_ms, request.max_steps, total_steps) # :1640
        raw_steps = density["scaled_steps"]  # :1641  (name is misleading)
        raw_steps_for_diag = density["raw_steps"] # :1642
        segment_diagnostics = [              # :1644-1656
            {"segment_index": idx,
             "segment_ms": float(segment_ms_list[idx]),
             "raw_steps": int(raw_steps_for_diag[idx]),
             "scaled_steps": int(raw_steps[idx]),
             "effective_scale": float(compute_effective_scale(...)),
             "scale": float(compute_effective_scale(...)),
             "density_ratio": float(density_ratio),
             "grid_ms": float(grid_ms)} for idx in range(len(segment_ms_list))]
        warning = check_budget_exhaustion(int(density["remaining"]), # :1659
                    int(request.max_steps), float(density_ratio)) # :1659

        for checkpoint_index, segment_steps in # :1663
            zip(range(1, len(ordered)), raw_steps): # :1663
            checkpoint = ordered[checkpoint_index] # :1664
            segment_ms = float(ordered[checkpoint_index].timestamp # :1666
                         - ordered[checkpoint_index-1].timestamp) # :1666
            effective_scale = compute_effective_scale( # :1667
                segment_ms, segment_steps, canonical_step, grid_ms) # :1667
            for step_index in range(segment_steps): # :1668
                progress = min(1.0, (step_index + 1) / segment_steps) # :1671
                target_normalized = normalized( # :1673
                    checkpoint.positions, session.joints) # :1673
                scaled_delta = [value * effective_scale # :1677
                                for value in delta] # :1677
                predicted = denormalized([value + change # :1678
                    for value, change in zip(current_normalized, # :1678
                                             scaled_delta)], session.joints) # :1678
                expected = _lerp_positions(    # :1682-1685
                    ordered[checkpoint_index-1].positions, # :1683
                    checkpoint.positions, progress) # :1684
```

Findings:

- **Intermediate checkpoints are preserved as distinct goals** — `for checkpoint_index, segment_steps in zip(range(1, len(ordered)), raw_steps)` with `target = checkpoint.positions` per segment. The model is stepped sequentially through each segment, not teleported to the final pose. `expected` is interpolated per segment (Source: `apps/api/app/main.py:1682-1685`).
- **But under `max_steps` budget, steps per segment are decimated.** `compute_rollout_density` computes `raw_steps = ceil(segment_ms / grid_ms)`. If `sum(raw_steps) > remaining`, it floors proportionally and round-robins leftovers (Source: `apps/api/app/main.py:766-774`). Example: three 1000 ms segments at `grid_ms=1` → `raw=3000`, `max_steps=160` → `scaled=160`, `density_ratio=18.75x`. The 3:1 test confirms `test_rollout_density_diagnostics_correlate_with_trimming` — Source: `apps/api/tests/test_main.py:246-277` — asserts `density_ratio > 1` and `sum(scaled)=remaining`.
- **Decimation changes per-step delta magnitude via `effective_scale`.** `effective_scale = (segment_ms / segment_steps) / canonical_step` (Source: `apps/api/app/main.py:807-811`). When `segment_steps` is squeezed, `effective_ms_per_step` grows, so `effective_scale > 1` (proven by `test_compute_effective_scale_decimation_aware` — Source: `apps/api/tests/test_main.py:320-338` asserts `compute_effective_scale(240, 1, 120, 120) == 2.0`). The model’s predicted delta is multiplied by `effective_scale` before denormalization (Source: `apps/api/app/main.py:1677`).
- **Approach can exhaust the budget before gesture even starts.** `remaining = max_steps - total_steps_after_approach` (Source: `apps/api/app/main.py:765` inside rollout; approach steps accumulated at `apps/api/app/main.py:1598-1629`). If `remaining==0`, `check_budget_exhaustion` emits “Gesture trimmed” — Source: `apps/api/app/main.py:831-835`, tested at `apps/api/tests/test_main.py:368-406`.

---

## 4. Evidence That All vs Only Endpoints Are Used

### 4.1 Evidence that ALL intermediate keyframes ARE used

| Observation | Source |
|-------------|--------|
| `authored_frames` returns `sorted(keyframes, key=frame)` — all entries, not `[0],[-1]` | `apps/api/app/main.py:862-868` |
| `build_incremental_samples` loops `range(len(route)-1)` with per-segment `duration` and per-step interpolation | `apps/api/app/main.py:981-995` |
| Frontend `buildIncrementalSamples` mirrors the same loop | `apps/web/src/domain/timeline.ts:194-209` |
| `buildReplayPlan` also iterates per timestamp and pushes final timestamp, preserving all knot times | `apps/web/src/domain/timeline.ts:175-188` |
| `test_tail_sample_emit` asserts 3 samples for a 250 ms segment at step 100, with `progress=1.0` on the tail — proves tail partial intervals are not dropped | `apps/api/tests/test_main.py:340-366` |
| `test_incremental_samples_learn_small_next_state_deltas` asserts `len(samples) >=3` for a 300 ms gesture at step 100, checking `delta` and `current` at interior steps | `apps/api/tests/test_main.py:106-122` |
| `test_rollout_teacher_forced_vs_autoregressive_diagnoses_mid_peak` trains on a 3-checkpoint gesture `[0,0]→[0.6,-0.4]→[0,0.4]` and asserts `len(frames) >=3` gesture-phase frames, plus `max(teacher_errors) < 0.05` and `max(auto_errors) < 0.06` — would fail if only endpoints were learned | `apps/api/tests/test_main.py:152-244` |
| Rollout `segment_diagnostics` array has one entry per segment (`len(segment_ms_list) == len(ordered)-1`) reporting `raw_steps`/`scaled_steps`/`effective_scale` per segment — impossible if only endpoints mattered | `apps/api/app/main.py:1644-1656` |
| Coordination diagnostics (`direction_alignment`, `simultaneity`) are computed per step across *all* segments; `multi_joint_steps` counts only steps where ≥2 joints expected to move | `apps/api/app/main.py:1150-1220` |

### 4.2 Evidence that ONLY endpoints might appear to be used (and why it is not code-level collapse)

| Suspicious path | Verdict |
|----------------|---------|
| Old `Demonstration.current` / `target` fields | **Not a collapse** — they exist as fallback only when `frames` empty (`if not frames: frames = [target]` — Source: `apps/api/app/main.py:941-943`) and as single-frame fabrication (`if len(frames)==1: frames=[current, target]` — Source: `apps/api/app/main.py:946-951`). When ≥2 checkpoints exist, they are ignored for sampling. |
| `if len(frames)==1` single-frame fallback | **Not collapsing multi-frame gestures** — only triggers when author really supplied 0 or 1 checkpoint. Multi-keyframe gestures bypass it. |
| `duration` clamping `max(end-start, step)` | **Does not drop segments** — it ensures degenerate (≤step) segments still emit one sample. Opposite of collapse. |
| `grid_ms` vs `timestep_ms` mismatch | **Duplication, not collapse** — `train_session` `has_fps` branch emits *both* timestep and grid samples (Source: `apps/api/app/main.py:1272-1312`). If anything, intermediates are *over-represented* when `timeline_fps` diverges. |
| `start_frame_index` slicing | **Genuine truncation of leading intermediates** — `frames = frames[start_index:]` (Source: `apps/api/app/main.py:943-945`). User-visible as “first N keyframes missing” if they set a non-zero start frame. |
| `max_steps` budget decimation | **Visible sparsification** — see §3.5. Not endpoint-only, but intermediate shape is under-sampled when `density_ratio >1`. |
| Goal = `segment_end` not final gesture end | **Not collapse, but loss of global context** — model never sees final pose until last segment; could learn segment-local shortcuts. |

**Bottom line:** No tested path reduces a 3+-checkpoint gesture to `frames[0]→frames[-1]` alone. The two red-herrings (`current/target`, single-frame fallback) only activate when no multi-frame gesture exists.

---

## 5. Root Causes for Observed “First/Last Only” Behavior

Even though code uses all segments, the user can still perceive endpoint-only learning. Six hypotheses below are ordered by likelihood and cite exact code.

### 5.1 `start_frame_index` misuse (high likelihood if user slices timeline)

- Source: `apps/api/app/main.py:943-945` — `frames = frames[min(start_frame_index, len-1):]`.
- Validation enforces `start_frame_index < authored_count` (Source: `apps/api/app/main.py:1456-1463`: `if authored_count and item.start_frame_index >= authored_count: raise 422`).
- If the UI defaults `start_frame_index` to something other than 0, or user scrubs the timeline start, all checkpoints before the index are silently dropped from training. The gesture then *is* endpoint-only *from the sliced route’s perspective* while the authored gesture still shows N keyframes. The export (`session.json`) stores `start_frame_index` — verify against what the user sees on the timeline.

### 5.2 Segment-local `progress` + `goal` conditioning (model under-determined between segments)

- Source: `apps/api/app/main.py:998-1001` — `goal = normalized(segment_end)` and `progress = next_progress` (0→1 per segment), reset at every segment boundary (Source: `apps/api/app/main.py:987`: `previous_delta = [0.0]*joint_count` at segment start).
- The MLP input is `current + goal + progress + previous_delta` (Source: `apps/api/app/main.py:1327`: `inputs = sample["current"] + sample["goal"] + [sample["progress"]] + previous_delta`). Because `goal` is only the *next* checkpoint, not the final gesture pose, and `progress` is segment-local, the model has no explicit “which segment am I in” or “how far through the whole gesture.”
- **Consequence:** Two interior points with similar `(current, goal, progress)` but from different segments become indistinguishable. The model can fit the average — which is endpoint-biased — while still achieving low per-step loss. `previous_delta` mitigates but is zeroed at segment boundaries, so boundary steps are ambiguous.

### 5.3 Autoregressive compounding drift (mid-trajectory peak)

- Source: `apps/api/tests/test_main.py:152-244` — diagnosis probe explicitly tests this: teacher-forced (ground-truth `previous_delta`) vs autoregressive rollout. Before the `previous_delta` history fix, `max(auto_errors)` exceeded the guardrail.
- Current `previous_delta` (Source: `apps/api/app/main.py:987-1003`) and DART-lite noise (Source: `apps/api/app/main.py:1007-1014`) reduce drift but do not eliminate it. If gesture has many checkpoints, small per-step bias compounds; middle checkpoints diverge while endpoints anchor (start is given `current`, end has more training mass because final segment’s `progress=1.0` tail is narrow).

### 5.4 Physics servo clipping + `effective_scale` interaction

- Servo: `servo_to_positions` — Source: `apps/api/app/main.py:546-587` — calls `p.setJointMotorControl2(..., force=effort, maxVelocity=velocity)` then `stepSimulation` substeps, returning `tracking_error = max(|achieved - target|)` and `clipped` count (Source: `apps/api/app/main.py:583-586`).
- Physics correction in training: `build_physics_feasible_samples` — Source: `apps/api/app/main.py:871-922` — servo-round-trips each `target_pos` and sets `corrected_delta = delta + (delta - feasible_delta)` (doubling the residual). If intermediate waypoints demand velocity beyond `joint.velocity`, clipping suppresses the delta; learned deltas shrink toward zero in high-velocity middle segments, leaving only slow endpoint moves unclipped.
- Rollout scaling: `scaled_delta = delta * effective_scale` (Source: `apps/api/app/main.py:1677`) multiplies the model’s prediction by a segment-specific scale. When decimation halves steps, `effective_scale≈2.0` doubles the delta *before* physics servo, potentially pushing more intermediate steps into clipping. Diagnostics report `max_tracking_error` and `clipped_steps` (Source: `apps/api/app/main.py:1692-1696`).

### 5.5 `max_steps` / `timeline_fps` / `timestep_ms` budget mismatches

- Default `TrainConfig.timestep_ms=120` (Source: `apps/api/app/main.py:326`), `TrainConfig.rollout_steps=160` (Source: `apps/api/app/main.py:329`), `RolloutRequest.timestep_ms=120` / `max_steps=160` (Source: `apps/api/app/main.py:405-414`).
- If user creates a long gesture at `timeline_fps=100` (`grid_ms=10`) with 3 segments of 1000 ms each, `raw_steps=[100,100,100]` → summed 300, `remaining=160` (after approach) → `scaled` trimmed and `density_ratio=1.88x` (Source: `apps/api/tests/test_main.py:278-303` ablation). Larger grids produce `density_ratio≫1`. Rollout then executes fewer interpolation points through interior waypoints; visually it “jumps.”
- The `has_fps` training path duplicates samples at `eff_step=round(1000/fps)` (Source: `apps/api/app/main.py:1280-1282`), so training saw dense steps but rollout is sparse — train/test timing mismatch.

### 5.6 Random-starts + approach plan dilution

- `random_starts=4` by default (Source: `apps/api/app/main.py:330`). Each extra start emits a full `build_approach_plan` (Source: `apps/api/app/main.py:734-737`: `approach_step_count` via `max_joint_step`). These approach samples use the same loss weight as gesture samples.
- If a gesture has, say, 3 segments × 2 steps = 6 gesture samples but `random_starts=4` adds ~4×N approach samples, approach dominates the batch. The model optimizes “get to first checkpoint” more than “hit the middle checkpoints.” Lower `epochs` or small `batch_size` exacerbates this.
- Approach in rollout: `build_approach_plan` runs *before* gesture segments and consumes `max_steps` budget (Source: `apps/api/app/main.py:1593-1629`). `total_steps` includes approach steps when computing `density` (Source: `apps/api/app/main.py:1640`), so a far initial `current` squeezes gesture steps.

### 5.7 Coordination weighting false negative (least likely to cause endpoint-only, but hides it)

- If the gesture requires simultaneous motion in middle segments but endpoints are single-joint, `coordination_sample_weights` up-weights multi-joint steps (Source: `apps/api/app/main.py:1089-1119`). If the user disables it (`coordination_weight=0`) or the target deltas are below `COORDINATION_ABS_EPS=0.005` (Source: `apps/api/app/main.py:1030`), the intermediate multi-joint shape is not emphasized and sequential L-shape execution appears low-error at endpoints.

---

## 6. Redesign Plan — Guarantee Full-Gesture Learning with N Keyframes

> Tasks are numbered; none may be skipped. Improvements are non-skipping enhancements that do not regress MLP simplicity or product guardrails (`AGENTS.md:31-41`). All changes stay inside owning app unless cross-cutting (per `AGENTS.md:14-18`). Verification via `apps/api: python -m pytest -q tests` and `apps/web: npm run test:unit && npm run build`, plus `./start-local.sh` + journey checks per `AGENTS.md:20-30`.

### Task 1 — Fix `start_frame_index` UX and training contract

1. **Make `start_frame_index` explicit in the UI.** Surface it as “Training window start” with a scrubber over `keyframes`/`frames`; show “N of M checkpoints used for training” next to the timeline. Today the slice is silent (Source: `apps/api/app/main.py:943-945`).
2. **Persist and validate per-dataset, not per-demonstration-global.** Either remove `Demonstration.start_frame_index` from the training inputs and use a `TrainRequest.selected_frame_range` (so archive stays intact), or add a dedicated endpoint that warns `start_frame_index > 0 truncates leading keyframes`.
3. **Add training diagnostic `authored_vs_used_checkpoints`.** Emit `{"authored": len(authored_frames), "used": len(route), "start_frame_index": start_index}` in `train_session` events so the user sees when they asked for 5 but trained on 2.
4. **Test:** `test_start_frame_index_trims_training_route_but_archive_preserved`.

### Task 2 — Segment-aware progress & goal conditioning (no new model inputs beyond scalar)

1. **Keep MLP-simple but disambiguate segments.** Either (a) change `progress` from segment-local to **gesture-global** `progress = global_elapsed / total_duration` (0→1 across whole gesture), or (b) add a scalar `segment_progress` alongside `segment_id / total_segments` as a normalized scalar (not one-hot) to keep input size `joint_count*3 + 2`. Current `inputs = current + goal + progress + previous_delta` (Source: `apps/api/app/main.py:1327-1328`); extending to +2 scalars preserves `expected_input_size` contract (Source: `apps/api/app/main.py:702-706`).
2. **Alternatively, keep `goal = next checkpoint` but add `final_goal` scalar blend.** E.g., `inputs = current + segment_goal + final_goal + global_progress + previous_delta` where `final_goal` is the last checkpoint (still MLP-simple, no recurrence). This gives the model final-pose context without telescoping `goal`.
3. **Continuity of `previous_delta` across segments.** Do not zero `previous_delta` at segment boundaries (Source: `apps/api/app/main.py:987`); instead carry the last delta of prior segment as the segment-start history, or emit an explicit `segment_boundary` binary flag. Zeroing erases momentum through interior waypoints.
4. **Test:** `test_global_progress_disambiguates_identical_segment_states` — two demonstrations with overlapping segment-local states but different global progress must yield different predictions; teacher-forced error must stay <0.03 everywhere.

### Task 3 — Multi-segment loss that weights interior checkpoints explicitly

1. **Per-segment or per-checkpoint loss weighting.** Beyond coordination weighting (Source: `apps/api/app/main.py:1089-1119`), add an option `checkpoint_weight` or `segment_weight` that up-weights interior segments (e.g., middle segment ×2) or any segment whose checkpoint has high curvature (large direction change from prior segment). This counters approach-dilution (Task 6) without adding layers.
2. **Interpolate uniformly, not just at step boundaries.** Current `np.arange(0, duration, step)` emits samples at grid points but `progress` is segment-local and `goal` is segment end; ensure samples are balanced per segment (e.g., equal samples per segment regardless of `segment_ms` or total-steps-proportional with floor). Today longer segments naturally emit more samples; short interior “via points” with tight timestamps can be under-represented.
3. **Test:** `test_interior_checkpoint_samples_balanced` — a gesture with 4 equal-time segments must produce equal sample counts per segment ±1; a gesture with a 100 ms via-point must emit at least one interior sample.

### Task 4 — Anti-skipping diagnostics (observable, not silent)

1. **Per-segment training diagnostics.** Extend `session.events` training payload (Source: `apps/api/app/main.py:1345-1360`) to include `segment_losses`, `segment_sample_counts`, `segment_direction_alignment` so a skipped interior segment shows as outlier loss/alignment.
2. **Rollout: surface `segment_diagnostics` prominently.** Already computed (Source: `apps/api/app/main.py:1644-1658`) but only returned as JSON. Promote to UI warning: if any segment has `scaled_steps < raw_steps * 0.5` or `effective_scale > 1.5`, highlight it as “interior waypoints under-sampled — increase max_steps or reduce timeline_fps.”
3. **Rollout: add per-checkpoint hit test.** After rollout, compute `hit = max(|predicted - expected| at checkpoint timestamps) < epsilon` for each authored checkpoint (not just final). Report `missed_checkpoints: [indices]` when interior checkpoints exceed threshold — this is the direct “first/last only” detector.
4. **Test:** `test_rollout_reports_missed_interior_checkpoints` — gesture with 3 checkpoints where rollout hits first/last but not middle must emit warning with `missed_checkpoints=[1]`.

### Task 5 — Budget-aware rollout without shape collapse

1. **Do not decimate uniformly when `density_ratio > 1`.** Current `compute_rollout_density` floors proportionally (Source: `apps/api/app/main.py:766-774`). Replace with a shape-preserving strategy: either (a) raise `max_steps` automatically when `sum(raw_steps) > max_steps` and `timeline_fps` indicates user intent for dense playback, or (b) keep `max_steps` but distribute excess to long segments while guaranteeing at least 2 steps per segment (so interior waypoints remain via points). The `largest_first` round-robin already partially does this; make the minimum explicit.
2. **Tie rollout `grid_ms` to training `has_fps` grid.** Today `train_session` duplicates grid samples (Source: `apps/api/app/main.py:1272-1312`) and rollout picks `grid_ms = 1000/timeline_fps if timeline_fps else timestep_ms` (Source: `apps/api/app/main.py:1633`). Unify: either train *only* at `grid_ms` when `timeline_fps` is set (no duplication), or rollout defaults to `canonical_step` when `timeline_fps` mismatches training.
3. **Cap `effective_scale` and warn on physics clipping.** `compute_effective_scale` (Source: `apps/api/app/main.py:804-811`) can double deltas when squeezed; clip `effective_scale` to `≤1.5×` or to `velocity_limit * grid_ms` and emit `clipped_steps` per segment. Surface `max_tracking_error` per segment, not just global (Source: `apps/api/app/main.py:1692`).
4. **Test:** `test_rollout_density_never_sparsifies_below_two_per_segment` and `test_effective_scale_capped_under_clipping_threshold`.

### Task 6 — Random-starts & approach not to dominate interior learning

1. **Balance approach vs gesture samples.** Either (a) make `random_starts` samples weighted separately (lower loss weight), or (b) cap approach sample count to `≤ gesture_sample_count`, or (c) expose `random_starts` per-demonstration with a UI hint “approach samples: X / gesture samples: Y.”
2. **Scripted vs learned approach parity.** Rollout `approach_mode="scripted"` (Source: `apps/api/app/main.py:1594-1603`) is bounded interpolation; `"learned"` (Source: `apps/api/app/main.py:1605-1629`) uses the model. Ensure both count toward `total_steps` consistently and that `check_budget_exhaustion` warning (Source: `apps/api/app/main.py:829-845`) is surfaced in UI, not just JSON `warnings`.
3. **Test:** `test_approach_samples_do_not_exceed_gesture_samples_by_factor` — with `random_starts=4` on a 3-checkpoint gesture, ratio must be ≤2× unless explicitly configured.

### Task 7 — Frontend timeline fidelity

1. **Respect `interpolation: "step"` if authored.** Today frontend `framesToKeyframes` hard-codes `"linear"` (Source: `apps/web/src/domain/timeline.ts:73-89`: `interpolation: "linear" as const`) and backend always `_lerp_positions`. Add step-hold behavior: if `keyframe.interpolation==="step"`, `_interpolate_frame_positions` should hold `previous.positions` until `next.timestamp`, not lerp. Document that `CONTEXT.md` checkpoint “motion between checkpoints is derived” includes step semantics.
2. **Keep `keyframesToFrames` / `framesToKeyframes` round-trip lossless.** Existing helpers `keyframesToFrames` (Source: `apps/web/src/domain/timeline.ts:91-104`) and `framesToKeyframes` (Source: `apps/web/src/domain/timeline.ts:73-89`) sort correctly but `framesToKeyframes` synthesizes IDs `keyframe-${index}-${timelineFrame}` losing original `interpolation`. Preserve it.
3. **Frontend `buildIncrementalSamples` must mirror backend `previous_delta` & DART noise exactly** for preview parity, or preview should call backend `build_incremental_samples` as source of truth. Today frontend omits `previous_delta` and `goal` (Source: `apps/web/src/domain/timeline.ts:188-231` — no `goal` field, no history).
4. **Test:** `test_step_interpolation_holds_previous_position_until_next_timestamp`.

### Task 8 — Preserve primitive URDF / MLP guardrails

1. **No recurrent architecture.** Tasks 2–3 stay within MLP-simple (per `CONTEXT.md: MLP` and `AGENTS.md:36`), no RNN/LSTM/Transformer — only input-feature augmentation and loss weighting, both undone by reverting feature size.
2. **Keep primitive URDF gate.** Do not relax mesh rejection (Source: `apps/api/app/main.py:56-58`); inertia synthesis stays as fallback.

---

## 7. Risks / Guardrails

| Risk | Guard |
|------|-------|
| Adding `global_progress` / `segment_id` grows `expected_input_size` (`joint_count*3+1` → `+2`) breaking old `model.pt` archives | Version `model_config` with `input_size` and reject mismatched weights with clear 409; keep `build_features` backward-compat branch (Source: `apps/api/app/main.py:709-720`: `if expected_size == len(current)*3+1: base+previous_delta else: base`); add migration that loads old models with `global_progress=segment_local` fill. |
| Doubling dataset via `has_fps` duplication (Source: `apps/api/app/main.py:1272-1312`) already inflates batch; adding per-segment weighting could starve single-joint pose demos | Gate weighting behind `kind=="gesture"` and `len(route)>2`; leave pose-only training at weight 1.0; add `pytest` guard `test_pose_training_unaffected_by_segment_weighting`. |
| `effective_scale` >1 hides velocity limit violation until physics clipping | Always report `clipped_steps` and `max_tracking_error` per segment; cap `effective_scale` to `velocity_limit*grid_ms / model_median_delta`. |
| `start_frame_index` change could silently retrain on truncated demonstrations and user loses prior model | Archive is primary artifact per `AGENTS.md:31-33`; never mutate stored `Demonstration` on train — use request-scoped window only. Export must round-trip `start_frame_index`. |
| `step` interpolation changes sampling distribution and breaks existing learned gestures | Feature-flag step vs lerp per keyframe; default remains lerp for backward compat. |

---

## 8. Sources

All line numbers verified 2026-09-07 against repo at `/home/cherry/Documents/robots`.

- `CONTEXT.md` — Frame/Keyframe/Checkpoint/Gesture/Demonstration/MLP/Physics-realistic replay/Coordination definitions.
- `AGENTS.md` — Repository boundaries, verification loop (`cd apps/api && python -m pytest -q tests`; `cd apps/web && npm run test:unit && npm run build`), product guardrails.
- `apps/api/app/main.py:354-387` — `DemonstrationFrame`, `Keyframe`, `Demonstration` models.
- `apps/api/app/main.py:740-745` — `_lerp_positions`.
- `apps/api/app/main.py:747-845` — `RolloutBudget`, `_compute_rollout_density_bundled`, `compute_rollout_density`, `compute_effective_scale`, `check_budget_exhaustion`.
- `apps/api/app/main.py:846-860` — `_interpolate_frame_positions`.
- `apps/api/app/main.py:862-870` — `authored_frames`.
- `apps/api/app/main.py:871-922` — `build_physics_feasible_samples`.
- `apps/api/app/main.py:925-1010` — `build_incremental_samples` (segment loop `:981-1003`, single-frame fallback `:946-951`, start_frame_index slicing `:943-945`).
- `apps/api/app/main.py:1261-1360` — `train_session` (has_fps duplication `:1272-1312`, physics branch `:1284-1312`, loss + coordination weighting `:1339-1360`).
- `apps/api/app/main.py:1557-1700` — `rollout` endpoint (approach budget `:1593-1629`, density `:1638-1661`, gesture segments `:1663-1687`, collision/coordination `:1690-1705`).
- `apps/web/src/types.ts:13-39` — `DemonstrationFrame`, `Keyframe`, `Demonstration`, `RolloutResponse.segment_diagnostics`.
- `apps/web/src/domain/timeline.ts:73-104` — `framesToKeyframes`, `keyframesToFrames`.
- `apps/web/src/domain/timeline.ts:134-160` — `interpolatePositions`.
- `apps/web/src/domain/timeline.ts:175-231` — `buildReplayPlan`, `buildIncrementalSamples`.
- `apps/api/tests/test_main.py:106-122` — `test_incremental_samples_learn_small_next_state_deltas`.
- `apps/api/tests/test_main.py:152-244` — `test_rollout_teacher_forced_vs_autoregressive_diagnoses_mid_peak`.
- `apps/api/tests/test_main.py:246-277` — `test_rollout_density_diagnostics_correlate_with_trimming`.
- `apps/api/tests/test_main.py:278-319` — `test_rollout_budget_ablation`.
- `apps/api/tests/test_main.py:320-338` — `test_compute_effective_scale_decimation_aware`.
- `apps/api/tests/test_main.py:340-366` — `test_tail_sample_emit`.
- `apps/api/tests/test_main.py:368-406` — `test_rollout_budget_exhaustion_warns`.

No code changes were made — research only.
