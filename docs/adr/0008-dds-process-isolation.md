# Keep DDS failures outside the web API process

## Evidence

On 2026-10-13 the frontend served HTML while every backend request timed out.
A stack dump showed native CycloneDDS writer destruction stalled during
disconnect, holding `RobotController.lock`. The main API thread was blocked
acquiring that lock inside the live target WebSocket handler. DDS callbacks
also appeared inside native finalization. The backend health check failed.

Read-only robot FSM RPC separately reported 0 (ZeroTorque), then 1 (Damp)
after an operator mode change, then 802 after a second change. Neither network
delivery nor a non-passive FSM value establishes motor acceptance;
simulator success cannot establish physical acceptance.

## Decision

Each physical DDS connection gets a spawned process that owns its SDK factory,
reader, writer and native callbacks. The API reads latest validated state and
waits for bounded publication acknowledgments. Startup has an eight-second
deadline; publication has a 150 ms deadline. Native teardown gets a short
grace period before process termination and reaping. Worker loss and deadlines invalidate measured
state and cause the existing controller to disarm. A stuck native write can
still prevent release delivery; process termination does not prove a robot stop.

The worker makes a best-effort zero-weight release after parent command silence
or parent loss, only if it previously received positive engagement. Startup
never sends motor commands. This is a software watchdog, not a robot-side one.

Do not hold the controller state lock across startup or teardown. Run live
WebSocket controller operations outside the API event loop. Shield disarm and
disconnect cleanup from browser/task cancellation.

This supersedes the backend restart requirement in ADR 0007: a new DDS process
can select another interface/domain after disconnecting. Keep the low-level
in-process adapter for packet construction and isolated protocol tools.

Browser robot requests have deadlines. Status polling allows one request in
flight and invalidates measured data during an outage, while preserving the
last reported arming state rather than claiming an undelivered disarm.

## Verification

Regression tests simulate hung initialization, native destruction, publication
and process crashes. They verify process reaping, reconnect, state invalidation,
responsive status and health while a live target waits for the controller lock.
The actual DDS controller lab checks simulated motion, return, release and
state-loss disarming through the process adapter. Physical acceptance still
requires an enabled robot mode and operator-controlled live testing.
