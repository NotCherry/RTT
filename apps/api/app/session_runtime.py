"""Concurrency primitives for simulation transactions and worker events."""
from functools import wraps
from threading import Lock


def serialized(method=None, *, allow_closed=False):
    """Hold the session's reentrant lock for a complete synchronous operation."""
    if method is None:
        return lambda implementation: serialized(implementation, allow_closed=allow_closed)
    @wraps(method)
    def invoke(session, *args, **kwargs):
        with session.lock:
            if getattr(session, "closed", False) and not allow_closed:
                raise ValueError("Simulation session is closed.")
            return method(session, *args, **kwargs)
    return invoke


class SessionEvents:
    def __init__(self):
        self._lock = Lock()
        self._events = []

    def append(self, event):
        with self._lock:
            self._events.append(event)

    def drain(self):
        with self._lock:
            events, self._events = self._events, []
            return events

    def __iter__(self):
        with self._lock:
            return iter(list(self._events))
