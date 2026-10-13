"""Bound DDS startup, publication and teardown independently of FastAPI."""
import multiprocessing
import threading
from .robot_dds_worker import run_dds_worker


class ProcessDDSAdapter:
    def __init__(self, config, worker_target=run_dds_worker, start_timeout=8,
                 publish_timeout=.15, close_timeout=.3):
        self.config, self.worker_target = config, worker_target
        self.start_timeout, self.publish_timeout, self.close_timeout = start_timeout, publish_timeout, close_timeout
        self.process = self.connection = self.reader = None
        self.ready, self.published, self.closed = threading.Event(), threading.Event(), threading.Event()
        self.lock, self.command_lock = threading.Lock(), threading.Lock()
        self._state = None
        self.error = None
        self.sequence = 0
        self.pending = None
        self.publish_error = None

    def start(self):
        context = multiprocessing.get_context("spawn")
        self.connection, child = context.Pipe()
        self.process = context.Process(target=self.worker_target,
            args=(child, self.config.model_dump()), name="unitree-dds", daemon=True)
        self.process.start()
        child.close()
        self.reader = threading.Thread(target=self._read, name="unitree-dds-state", daemon=True)
        self.reader.start()
        if not self.ready.wait(self.start_timeout):
            self._fault("DDS initialization timed out")
        if self.error:
            self.close()
            raise RuntimeError(self.error)

    def _fault(self, reason):
        with self.lock:
            if self.error is None:
                self.error = reason
            self._state = None
        self.ready.set()
        self.published.set()

    def _read(self):
        try:
            while not self.closed.is_set():
                if not self.connection.poll(.1):
                    if not self.process.is_alive():
                        raise EOFError
                    continue
                operation, payload = self.connection.recv()
                if operation == "started":
                    self.ready.set()
                elif operation == "state":
                    with self.lock:
                        if not self.error:
                            self._state = payload
                elif operation == "published":
                    sequence, error = payload
                    with self.lock:
                        if sequence == self.pending:
                            self.publish_error = error
                            self.published.set()
                elif operation == "error":
                    self._fault(f"DDS worker failed: {payload}")
        except (EOFError, OSError, TypeError):
            if not self.closed.is_set():
                self._fault("DDS worker stopped; measured state is unavailable")

    def state(self):
        with self.lock:
            return None if self.error or self.closed.is_set() else self._state

    def publish(self, positions, velocities, weight, mode_machine):
        with self.command_lock:
            if self.closed.is_set() or self.error:
                raise RuntimeError(self.error or "DDS connection is closed")
            with self.lock:
                self.sequence += 1
                self.pending = self.sequence
                self.publish_error = None
                self.published.clear()
            try:
                self.connection.send(("publish", (self.sequence, positions, velocities, weight, mode_machine)))
            except (BrokenPipeError, EOFError, OSError) as exc:
                self._fault("DDS worker connection failed")
                raise RuntimeError(self.error) from exc
            if not self.published.wait(self.publish_timeout):
                self._fault("DDS command publication timed out; disarmed")
                self._stop_process()
            if self.error or self.publish_error:
                raise RuntimeError(self.error or self.publish_error)

    def _stop_process(self):
        if self.process and self.process.is_alive():
            self.process.terminate()
            self.process.join(timeout=.3)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(timeout=.3)

    def close(self):
        if self.closed.is_set():
            return
        self.closed.set()
        if self.connection:
            try:
                self.connection.send(("close", None))
            except (BrokenPipeError, EOFError, OSError):
                pass
        if self.process and self.process.pid is not None:
            self.process.join(timeout=self.close_timeout)
            self._stop_process()
        if self.reader and self.reader is not threading.current_thread():
            self.reader.join(timeout=.2)
        if self.connection:
            self.connection.close()
        with self.lock:
            self._state = None
