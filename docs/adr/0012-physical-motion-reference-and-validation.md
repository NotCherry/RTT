# Physical motion reference and validation candidate

The operator requested physical movement to match the browser URDF, then confirmed
the G1 and USB/IP camera rig are unavailable for this implementation. Complete
software instrumentation and report hardware acceptance separately.

The 60 Hz browser URDF reference remains independently visible and is sampled
into camera packets by shared joint name. It is diagnostic data, never a motor
command. A different preview robot can have different geometry; joints absent
from that preview have no reference comparison. Raw physical retargeting targets,
independently limited commands, and fresh measured feedback remain separate.

The selectable **Match preview · validation candidate** uses the preview's arm
speed capped at 3 rad/s and 10 rad/s². The conservative 1 rad/s, 3 rad/s² profile
remains the default pending physical validation, as required by the implementation
plan. Explicit settings persist, never arming intent. Positive source URDF velocity
limits additionally cap backend trajectories. Waist retains 0.5 rad/s, 1 rad/s²
and its existing restricted camera range. Gains, two-second engagement, ownership,
250 ms watchdog and 1 rad tracking-error release remain intact.

Status exposes observation processing, packet sequence/age, controller publication
time, feedback receipt age and per-joint reference/command/measured errors and
speed/range clipping. Browser timing is not exposure timing. The UI's sampled trace
helps inspection; export retains up to 1,500 controller ticks. Analysis occurs
outside the controller lock, excludes startup engagement, reports mean/p95 error
and fits reference-to-command and command-to-measured delays separately in 20 ms
steps over 0–500 ms. A fit is not a hardware latency certification; static or
insufficient motion returns no delay estimate. This export never contains video.

Hardware acceptance must compare the conservative profile and candidate on the
actual G1 with the intended detector/rig. Measure slow and rapid arm movements,
raised poses, waist limits, tracking breaks, stop and connection loss. Inspect
startup separately. Choose final acceleration and release thresholds from measured
error, oscillation, clipping and lag; do not claim speed parity from a dropdown,
mock transport or synthetic trace. Promote a faster default only after that check.
