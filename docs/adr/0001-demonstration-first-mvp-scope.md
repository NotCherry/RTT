---
status: accepted
---

# Keep the MVP centered on archived demonstrations

The product is a pose and gesture teaching environment, not a generic random-pose estimator or an ML metrics dashboard. The MVP therefore treats recorded demonstrations—static poses and, as the model evolves, timestamped gesture frames—as the primary artifact for inspection, replay, and archival. A secondary testing view may show model behavior and training progress with charts and metrics, but those diagnostics remain subordinate to the demonstration workflow. The initial model scope stays deliberately simple and MLP-oriented; advanced topology editing, multiple layer/activation exploration, and genetic-algorithm search are deferred while keeping a future architectural seam for exploring other network shapes and model families.

## Considered options

- Make random pose prediction and loss reporting the primary workflow.
- Build an advanced model editor before the recording and archive workflow is mature.
- Center the MVP on demonstrations and add model diagnostics as a secondary view.

The third option was chosen because it supports the immediate teaching and experiment-archival goal without preventing future model research.

## Consequences

- Demonstration recording, review, replay, and export are first-class product work.
- Training metrics belong in a test or diagnostics view rather than the main teaching surface.
- MLP training can remain straightforward in the current scope.
- Future model families and topology-search experiments should be introduced behind an explicit extension point rather than shaping the MVP prematurely.
