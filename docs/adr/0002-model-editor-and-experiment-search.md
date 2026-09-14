# Model editor and experiment search

The Model editor owns a versioned, declarative `ModelSpec`. The browser may compose supported blocks, but it never sends executable Python. The backend policy compiler validates tensor compatibility, resource limits, and supported block settings before it creates a PyTorch model. Prediction, rollout, export, and evaluation consume the compiled policy through the existing state-to-joint-action contract and do not branch on editor UI concepts.

The first adapter is the existing temporal MLP. Its specification is a sequential stack with locked robot-state input and joint-action output blocks. New policy families may add high-level blocks only when their runtime behavior can satisfy a stable prediction interface. Paper-inspired presets are curated model specifications, not claims that this state-only environment reproduces the original papers' inputs, data scale, or results.

An Experiment run compares candidate training configurations against one immutable demonstration snapshot. Candidate metrics are diagnostics stored alongside the experiment; they never replace or mutate demonstrations. The browser Archive remains the durable owner of experiment records, while backend sessions own temporary workers and the currently promoted model.

Quick search is deliberately bounded and sequential by default. It retains only the current model and best candidate, emits each candidate result incrementally, and promotes the best completed candidate when the run finishes. Search scores and their versions are explicit. The initial score uses checkpoint reproduction error when available and training loss as a fallback; it is a comparison aid, not a substitute for final Evaluation.

Architecture and parameter search share one experiment interface so later complete, evolutionary, and multi-budget strategies can vary behind an internal search seam. Parallel workers remain opt-in and must respect an explicit memory budget. A cancelled or failed candidate must release its model before another candidate begins.
