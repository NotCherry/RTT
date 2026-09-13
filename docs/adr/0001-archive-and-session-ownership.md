# Archive ownership and simulation sessions

Browser archives own authored demonstrations; backend simulation sessions are temporary working copies used for training, evaluation, and export. Training a selected demonstration must not replace the archive. Uploaded robots use the SHA-256 digest of their original URDF bytes as their stable identity, so re-uploading identical content restores its browser archive; changing the content deliberately selects a different archive.

`Demonstration.dataset_id` is the canonical single-dataset membership. Dataset member lists are derived for compatibility with the existing export contract, and new datasets start empty. Browser archive edits are normalized and synchronized through one ordered queue: demonstrations must be accepted before their dataset references, and later edits must not overtake earlier edits. This keeps the existing endpoints usable without introducing a second authority for membership.

Each simulation session serializes complete physics transactions, including sampling and rollout, under a reentrant lock; individual state operations use the same lock. WebSocket callers wait in worker threads so a long physics transaction does not block the event loop. Worker events have an independent atomic drain. Sessions support explicit deletion and expire after 30 minutes without activity, except while training is running. Persisted robot files and browser archives are not deleted when a session expires.

Training workers belong to their session rather than to the HTTP request loop. Shutdown requests cooperative cancellation and waits up to five seconds per worker; any worker still exiting owns final physics-client cleanup. Physics failures either produce an evaluation error or an explicit warning when training falls back to kinematic samples.

Archives stored under old randomly generated upload identifiers cannot be rediscovered from URDF content alone. They remain untouched in browser storage; previously exported archives are also unaffected. Byte-identical re-uploads are stable from this version onward.
