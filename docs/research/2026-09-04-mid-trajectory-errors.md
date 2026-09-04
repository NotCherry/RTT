# Mid-Trajectory Error Peak in Temporal Behavior Cloning

Date: 2026-09-04 | Status: research, no code changed
Scope: `apps/api/app/main.py` (`build_incremental_samples`, `make_model`, `train_session`, `rollout`), `docs/staged-behavior-evaluation.md`, `docs/adr/0002-timeline-based-teaching-and-curriculum-training.md`, `CONTEXT.md`.

## 1. Observed pattern (in repo domain terms)

- **Evaluation:** `POST /rollout` gesture phase autoregressively rolls the temporal MLP checkpoint-to-checkpoint and compares each prediction against the linearly-interpolated expected frame (`expected = _lerp_positions(prev_checkpoint, checkpoint, progress)`, `main.py` rollout).
- **Symptom:** per-step MAE (prediction vs expected, native units) is small at the first and final frames of a gesture but peaks mid-gesture (~0.65), roughly bell-shaped over time.
- **Training data:** `build_incremental_samples` expands authored checkpoints/keyframes into incremental `(current + goal + progress) -> delta` samples via `_lerp_positions` at `timestep_ms` grid (`main.py:471-534`).
- Translation: the model nails segment endpoints but sags or overshoots in the middle of each checkpoint segment. A ~0.65 native-unit mid-segment error is large against the staged-evaluation bound of 0.05 per the approach/gesture metric (`docs/staged-behavior-evaluation.md` Metrics).

## 2. Likely causes (ranked)

### C1. Compounding / covariate shift (train on expert states, test on own states)
- **Why:** training samples sit exactly on the authored lerp line; rollout feeds the model's own drifted `current` back in (`main.py:803-812`), so mid-segment inputs are off-distribution and errors compound. Endpoints re-anchor (each segment's goal checkpoint resets context; final frame error is measured near a checkpoint), producing the bell shape.
- **Source:** Ross & Bagnell, "Efficient Reductions for Imitation Learning" (DAgger, http://proceedings.mlr.press/v15/ross11a/ross11a.pdf); Ross et al., "A Reduction of Imitation Learning and Structured Prediction to No-Regret Online Learning" (https://arxiv.org/abs/1011.0686); Pomerleau, "ALVINN" behavior-cloning baseline (https://proceedings.neurips.cc/paper/1988/file/812b4ba287f5ee0bc9d43bbf5bbe87fb-Paper.pdf).
- **How to check in this repo:** log per-step `|current - expected|` alongside MAE in `rollout`; confirm error grows with steps-since-segment-start and resets at each checkpoint; compare teacher-forced (feed `expected` as next `current`) vs autoregressive rollout error.

### C2. Train/eval progress-feature mismatch + goal conditioning reset
- **Why:** training `progress = elapsed/duration` starts at 0 per segment (`main.py:521`), but rollout uses `progress = (step_index+1)/segment_steps` starting at `1/N` and with `segment_steps` derived from `timeline_fps`/budget rescaling (`main.py:803`), so mid-segment progress values seen at eval were sparsely/inconsistently covered in training. Also the `goal` input switches discretely at each checkpoint while `current` moves continuously, so mid-segment `(current, goal, progress)` triples are the most ambiguous.
- **Source:** `apps/api/app/main.py:521-522,553,782-812`; ADR-0002 temporal MLP spec (`docs/adr/0002-timeline-based-teaching-and-curriculum-training.md`).
- **How to check:** dump histograms of training `progress` values per segment vs rollout `progress` grid; plot predicted `delta` vs progress for fixed `(current, goal)` — flat or noisy mid-range response confirms ambiguity.

### C3. Largest target deltas live mid-segment; SmoothL1 + full-batch averaging underfits them
- **Why:** for linear interp, per-step `delta` magnitude is uniform, but absolute displacement from either endpoint (and multi-joint vector error, summed over joints) peaks mid-segment; a bell-shaped MAE is exactly what a mean-seeking regressor shows when it shrinks predictions toward the segment mean. `SmoothL1Loss` (`main.py:559`) further down-weights small residuals (<1.0), softening correction of moderate drift. Training is full-batch (`model(x)` on all samples, `main.py:561-566`) — `batch_size` config (`main.py:205`) is never used — so gradients average over easy endpoint samples and wash out mid-segment corrections.
- **Source:** `apps/api/app/main.py:205,553-566`; PyTorch docs `torch.nn.SmoothL1Loss` (https://pytorch.org/docs/stable/generated/torch.nn.SmoothL1Loss.html).
- **How to check:** plot target `|delta|` and residual vs progress; verify residuals are systematically biased (under-shoot) mid-segment rather than zero-mean noise; re-train with `MSELoss` and compare mid-segment MAE.

### C4. MLP spectral bias + no history: smooths through the segment middle
- **Why:** default `[64,64]` ReLU MLP (`TrainConfig`, `make_model`, `main.py:196-228`) is a small stateless map `(current, goal, progress) -> delta`. ReLU MLPs learn low-frequency functions first and smooth sharp mid-segment corrections; with no velocity/history input, identical `(current, goal)` at different segment phases must produce different deltas, distinguished only by the single scalar `progress`.
- **Source:** Rahaman et al., "On the Spectral Bias of Neural Networks" (https://arxiv.org/abs/1806.08734); `docs/adr/0002...` Consequences ("MLP remains a small controller rather than a general sequence model").
- **How to check:** sweep `hidden_layers`/`activation` (tanh vs relu) and plot mid-segment MAE; if error peak persists across widths but drops when a previous-delta/velocity feature is added, capacity/statelessness is confirmed.

### C5. Uniform time grid under-samples what matters (data density)
- **Why:** `np.arange(0, duration, step)` (`main.py:520`) places equal samples everywhere, so rare corrective states (slightly off-line mid-segment) have zero coverage; random starts only enrich the approach phase (`main.py:501-516`), not gesture middles.
- **Source:** `apps/api/app/main.py:501-530`; Laskey et al., "DART: Noise Injection for Robust Imitation Learning" (https://arxiv.org/abs/1703.09327) on missing corrective coverage.
- **How to check:** count samples per progress decile; verify ~uniform while errors are bell-shaped — mismatch implicates missing off-line data, not quantity.

### C6 (minor). Normalization scale + joint summation
- **Why:** `normalized()` maps each joint to [-1,1] (`main.py:382-387`), so a joint with a wide URDF range gets small normalized deltas and contributes little loss, while MAE in native units sums all joints — one drifting wide-range joint can dominate the mid-gesture peak.
- **How to check:** report per-joint MAE vs progress; check whether one joint accounts for most of the 0.65 peak.

## 3. Mitigation techniques (fit vs MLP-simple, demonstration-first guardrails)

| Technique | Effect on bell curve | Cost / guardrail fit |
|---|---|---|
| Noise injection / DART-style corrective samples (perturb `current` off the lerp line, supervise with return-to-line delta) | Directly covers mid-segment drift states; cheapest fix for C1/C5 | Low; stays in `build_incremental_samples`, MLP unchanged, demonstration-first preserved. See Laskey et al. https://arxiv.org/abs/1703.09327 |
| DAgger-lite: collect rollout states, label corrections with scripted `_lerp_positions` return, append to training set, retrain | Same as above but on-policy; gold standard for C1 | Medium; reuses scripted controller as expert (`build_approach_plan`, staged spec); no arch change. Ross et al. http://proceedings.mlr.press/v15/ross11a/ross11a.pdf |
| Mid-segment sample weighting/oversampling (weight loss by `sin(pi*progress)` or duplicate mid deciles) | Forces mean-seeking loss to fit the middle (C3/C5) | Very low; one-line loss weight in `train_session` |
| Swap SmoothL1 -> MSE, honor `batch_size` with mini-batch SGD | Larger gradients on mid-segment residuals; stochastic batches escape endpoint-averaged minima (C3) | Very low; config already exposes `batch_size` (`main.py:205`) |
| Add stateless history features: previous delta / velocity, or short window of past currents | Disambiguates phase without leaving MLP family (C4) | Low-medium; input size change in `build_incremental_samples` + `rollout`; still MLP-simple per `CONTEXT.md` |
| Per-joint loss weighting / native-unit loss | Stops wide-range joint dominating (C6) | Low |
| Hyperparams: wider layers, tanh/GELU, LR schedule, more epochs | May shave the peak (C4) | Low but diminishing; keep MLP-oriented per ADR-0002 |
| LSTM/Transformer sequence policy | Best long-horizon fix (C4) | **Deferred**: contradicts "MLP-oriented and simple" guardrail (`AGENTS.md`, ADR-0002); note as future architecture exploration |
| Reward/RL closed-loop tuning | N/A — no reward/safety model in repo | Out of scope; demonstration-first product (`CONTEXT.md`) |

## 4. Recommended next experiments (concrete, no code changed yet)

1. **Diagnose before treating — per-checkpoint error + velocity profiles.** Extend `rollout` response handling (frontend or a test script) to record per-step MAE, per-joint error, and `|expected_t - expected_{t-1}|` vs progress. Files: `apps/api/app/main.py` (rollout), `apps/web/src/App.tsx` (`testModel`). Metric: confirm peak aligns with mid-`progress` and with max displacement-from-nearest-endpoint; check single-joint dominance (C6).
2. **Teacher-forced vs autoregressive ablation.** Run rollout twice: once feeding `expected` as next `current` (lossless), once as today. Files: `apps/api/tests/test_main.py` (add `test_rollout_teacher_forced_vs_autoregressive`). Metric: if teacher-forced MAE is flat and autoregressive is bell-shaped, C1 compounding is confirmed and DAgger/noise is the right fix.
3. **Noise-injection training (DART-lite).** In `build_incremental_samples`, add Gaussian perturbation to `current` on gesture segments with target delta recomputed toward the lerp line; keep `random_starts` for approach only. Files: `apps/api/app/main.py:471-534`, `apps/api/tests/test_main.py`. Metric: mid-decile (progress 0.3-0.7) MAE on held-out gesture; expect peak 0.65 -> <0.2 with no endpoint regression.
4. **Loss/optimizer hygiene: MSE + real mini-batches + progress weighting.** Switch `SmoothL1Loss` -> `MSELoss`, loop over `config.batch_size`, weight samples by mid-segment emphasis. Files: `apps/api/app/main.py:205,553-566`. Metric: training loss trajectory + mid-segment MAE; each change ablated independently.
5. **Stateless history feature (still MLP).** Append previous-step delta (zeros at segment start) to the input vector in both `build_incremental_samples` and `rollout` feature construction. Files: `apps/api/app/main.py:553,767,806`, `make_model` input size. Metric: mid-segment MAE vs parameter-matched baseline; if it wins, adopt before ever considering LSTM/Transformer (guardrail: keep MLP-simple).

## Sources

- Repo: `apps/api/app/main.py` (`build_incremental_samples:471`, `make_model:214`, `train_session:536`, `rollout:732`, `normalized:382`, `TrainConfig:196`), `docs/staged-behavior-evaluation.md`, `docs/adr/0002-timeline-based-teaching-and-curriculum-training.md`, `CONTEXT.md`.
- Ross, Gordon & Bagnell, DAgger (http://proceedings.mlr.press/v15/ross11a/ross11a.pdf); Ross et al. no-regret imitation (https://arxiv.org/abs/1011.0686); Pomerleau ALVINN (https://proceedings.neurips.cc/paper/1988/file/812b4ba287f5ee0bc9d43bbf5bbe87fb-Paper.pdf).
- Laskey et al., DART noise injection (https://arxiv.org/abs/1703.09327); Rahaman et al., spectral bias (https://arxiv.org/abs/1806.08734); PyTorch SmoothL1Loss docs (https://pytorch.org/docs/stable/generated/torch.nn.SmoothL1Loss.html).
