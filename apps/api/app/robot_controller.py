"""One operator owns the arm controller; network targets never queue up."""
import secrets
import threading
import time
from .robot_dds import create_adapter
from .robot_motion import ARM_LIMITS, advance_motion, arm_names
from .robot_transport_contract import TargetPacket


class RobotController:
    def __init__(self, adapter_factory=create_adapter, clock=time.monotonic, wall_clock=time.time):
        self.factory, self.clock, self.wall_clock = adapter_factory, clock, wall_clock
        self.lock = threading.RLock()
        self.lifecycle = threading.Lock()
        self.adapter = self.config = self.token = None
        self.worker = None
        self.stop_event = threading.Event()
        self.armed = False
        self.stream = None
        self.sequence = -1
        self.target = None
        self.target_at = -float("inf")
        self.positions, self.velocities = {}, {}
        self.weight = 0.0
        self.reason = "Disconnected"
        self.sent = 0

    def connect(self, config, run_worker=True):
        with self.lifecycle, self.lock:
            if self.adapter is not None:
                raise ValueError("A controller is already connected; disconnect it first")
            adapter = self.factory(config)
            try:
                adapter.start()
            except Exception as exc:
                adapter.close()
                raise RuntimeError(f"Robot connection failed: {exc}") from exc
            self.adapter, self.config = adapter, config
            self.token = secrets.token_urlsafe(32)
            self.armed, self.weight, self.sent = False, 0.0, 0
            self.positions, self.velocities = {}, {}
            self.reason = "Connected · waiting for measured state"
            self.stop_event.clear()
            if run_worker:
                self.worker = threading.Thread(target=self._run, name="robot-arm-control", daemon=True)
                self.worker.start()
            return self.token

    def authorize(self, token):
        if not self.token or not token or not secrets.compare_digest(self.token, token):
            raise PermissionError("Robot controller ownership token is invalid")

    def fresh_state(self):
        state = self.adapter.state() if self.adapter else None
        return state if state and self.clock() - state.received_at <= self.config.stale_after_ms / 1000 else None

    def arm(self, token):
        with self.lock:
            self.authorize(token)
            if self.armed:
                return
            state = self.fresh_state()
            if state is None:
                raise ValueError("Fresh measured robot state is required before arming")
            names = arm_names(self.config.robot_model)
            if set(state.positions) != set(names) or any(not ARM_LIMITS[name][0] <= state.positions[name] <= ARM_LIMITS[name][1] for name in names):
                raise ValueError("Measured arm positions do not match the selected G1 contract or joint limits")
            self.positions = dict(state.positions)
            self.velocities = dict.fromkeys(names, 0.0)
            self.target, self.target_at, self.sequence = None, -float("inf"), -1
            self.weight, self.armed = 0.0, True
            self.reason = "Armed · waiting for live camera"

    def disarm(self, token):
        with self.lock:
            self.authorize(token)
            self._release("Disarmed by operator")

    def attach_stream(self, token):
        with self.lock:
            self.authorize(token)
            if self.stream is not None:
                raise ValueError("Another camera stream owns this controller")
            self.stream = secrets.token_hex(16)
            self.sequence = -1
            return self.stream

    def detach_stream(self, stream):
        with self.lock:
            if stream == self.stream:
                self.stream = None
                self._release("Camera disconnected · disarmed")
                return True
            return False

    def receive(self, stream, packet: TargetPacket):
        with self.lock:
            if stream != self.stream or stream is None:
                raise PermissionError("Camera stream is not the owner")
            age_ms = self.wall_clock() * 1000 - packet.sent_at_ms
            if age_ms < -100 or age_ms > self.config.stale_after_ms:
                raise ValueError("Target packet is stale or has an invalid timestamp")
            if packet.sequence <= self.sequence:
                raise ValueError("Out-of-order target packet")
            if any(name not in arm_names(self.config.robot_model) for name in packet.positions):
                raise ValueError("Joint is unavailable on the selected robot model")
            self.sequence = packet.sequence
            # Disarmed targets never carry over to a subsequent arm action.
            if self.armed:
                self.target = dict(packet.positions) if packet.tracking and packet.positions else None
                self.target_at = self.clock()

    def _release(self, reason):
        self.armed, self.target = False, None
        self.velocities = dict.fromkeys(self.positions, 0.0)
        self.weight = 0.0
        self.reason = reason
        if self.adapter and self.positions:
            state = self.adapter.state()
            try:
                self.adapter.publish(self.positions, self.velocities, 0.0, state.mode_machine if state else 0)
                self.sent += 1
            except Exception as exc:
                self.reason += f"; release publication failed: {exc}"

    def tick(self, dt=0.02):
        with self.lock:
            if not self.adapter or not self.armed:
                return
            state = self.fresh_state()
            if state is None:
                self._release("Robot state stale · disarmed")
                return
            if any(abs(state.positions.get(name, q) - q) > 1.0 for name, q in self.positions.items()):
                self._release("Measured tracking error exceeds 1 rad · disarmed")
                return
            active = self.target is not None and self.clock() - self.target_at <= self.config.stale_after_ms / 1000
            if active:
                # Missing/occluded channels retain their last command, not browser neutral.
                self.positions, self.velocities = advance_motion(self.positions, self.velocities, self.target, dt,
                    self.config.max_joint_speed, self.config.max_joint_acceleration)
                self.reason = "Following live camera"
            else:
                self.velocities = dict.fromkeys(self.positions, 0.0)
                self.reason = "Tracking lost · holding last command"
            self.weight = min(1.0, self.weight + min(dt, 0.04) / 2.0)
            try:
                self.adapter.publish(self.positions, self.velocities, self.weight, state.mode_machine)
                self.sent += 1
            except Exception as exc:
                self._release(f"Transport fault · disarmed: {exc}")

    def status(self):
        with self.lock:
            state = self.fresh_state()
            reason = "Connected · ready to arm" if state and self.reason.startswith("Connected") else self.reason
            return {"connected": self.adapter is not None, "armed": self.armed, "reason": reason,
                "transport": self.config.transport if self.config else None, "state_fresh": state is not None,
                "measured": dict(state.positions) if state else {}, "commanded": dict(self.positions),
                "packets_sent": self.sent, "engagement": self.weight}

    def _run(self):
        previous = self.clock()
        while not self.stop_event.wait(0.02):
            now = self.clock()
            try:
                self.tick(now - previous)
            except Exception as exc:
                with self.lock:
                    self._release(f"Controller fault · disarmed: {exc}")
            previous = now

    def disconnect(self, token=None):
        # Serialize lifecycle changes while the worker joins outside the state lock.
        # A second disconnect must never close a newly connected adapter.
        with self.lifecycle:
            self._disconnect(token)

    def _disconnect(self, token):
        with self.lock:
            if token is not None:
                self.authorize(token)
            self.stop_event.set()
            self._release("Disconnected")
            worker = self.worker
        if worker and worker is not threading.current_thread():
            worker.join(timeout=2)
        with self.lock:
            if self.adapter:
                self.adapter.close()
            self.adapter = self.config = self.token = self.stream = self.worker = None
