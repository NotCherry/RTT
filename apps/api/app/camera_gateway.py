"""Configured source identities and bounded IP-camera process lifecycle."""
import json
import multiprocessing as mp
import os
import queue
import re
import threading
import time
import uuid
from urllib.parse import urlsplit
from .camera_gateway_worker import capture_source


def configured_sources(value=None):
    try:
        sources = json.loads(value if value is not None else (os.environ.get("RTT_CAMERA_SOURCES") or "{}"))
        if not isinstance(sources, dict) or len(sources) > 16:
            raise ValueError()
        for identity, source in sources.items():
            if not re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", identity) or not isinstance(source, dict):
                raise ValueError()
            if not isinstance(source.get("url"), str) or not isinstance(source.get("name", identity), str):
                raise ValueError()
            address = urlsplit(source["url"])
            if address.scheme not in ("rtsp", "rtsps", "http", "https") or not address.hostname:
                raise ValueError()
            if len(source["url"]) > 2048 or len(source.get("name", identity)) > 128:
                raise ValueError()
        return sources
    except (ValueError, TypeError, KeyError):
        raise ValueError("Invalid RTT_CAMERA_SOURCES configuration; use named RTSP/HTTP camera endpoints") from None


class GatewayCapture:
    def __init__(self, url):
        self.url, self.epoch = url, str(uuid.uuid4())
        context = mp.get_context("spawn")
        self.frames, self.stop = context.Queue(maxsize=1), context.Event()
        self.process = context.Process(target=capture_source, args=(url, self.frames, self.stop), daemon=True)
        self.latest = None
        self.lock = threading.Lock()
        self.last_request = time.monotonic()
        self.process.start()

    def snapshot(self, timeout=6):
        with self.lock:
            self.last_request = time.monotonic()
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                try:
                    self.latest = self.frames.get(timeout=.05 if self.latest is None else .001)
                    while True:
                        self.latest = self.frames.get_nowait()
                except queue.Empty:
                    pass
                age = time.monotonic() * 1000 - self.latest["decoded_monotonic_ms"] if self.latest else None
                if age is not None and 0 <= age <= 250:
                    return {**self.latest, "epoch": self.epoch, "server_time_ms": time.time()*1000, "source_age_ms": age, "timing": "backend-decode"}
                if not self.process.is_alive():
                    raise RuntimeError("Camera source stopped or could not be decoded")
            raise TimeoutError("Camera source has no fresh decoded frame")

    def close(self):
        with self.lock:
            self.stop.set()
            self.process.join(.1)
            if self.process.is_alive():
                self.process.terminate()
                self.process.join(1)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(1)
            self.frames.close()
            self.frames.cancel_join_thread()


class CameraGateway:
    def __init__(self):
        self.lock = threading.Lock()
        self.captures = {}
        self.shutdown = threading.Event()
        self.maintenance = threading.Thread(target=self._maintain, daemon=True)
        self.maintenance.start()

    def snapshot(self, identity):
        source = configured_sources().get(identity)
        if source is None:
            raise KeyError("Camera source is not configured")
        with self.lock:
            capture = self.captures.get(identity)
            if capture and capture.url != source["url"]:
                capture.close()
                del self.captures[identity]
                capture = None
            if not capture:
                if len(self.captures) >= 3:
                    raise RuntimeError("Three camera sources are already active")
                capture = GatewayCapture(source["url"])
                self.captures[identity] = capture
        return capture.snapshot()

    def _maintain(self):
        while not self.shutdown.wait(2):
            with self.lock:
                expired = [identity for identity, capture in self.captures.items() if time.monotonic() - capture.last_request > 10 or not capture.process.is_alive()]
                for identity in expired:
                    self.captures.pop(identity).close()

    def close(self):
        self.shutdown.set()
        self.maintenance.join(3)
        with self.lock:
            for capture in self.captures.values():
                capture.close()
            self.captures.clear()
