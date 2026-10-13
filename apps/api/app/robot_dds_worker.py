"""Own native DDS entities in a disposable process, never in the API process."""
import time
from .robot_dds import UnitreeArmAdapter
from .robot_transport_contract import ConnectionConfig


def run_dds_worker(connection, config, adapter_factory=UnitreeArmAdapter):
    adapter = adapter_factory(ConnectionConfig.model_validate(config))
    last_state = None
    last_command = None
    last_command_at = 0
    try:
        adapter.start()
        connection.send(("started", None))
        while True:
            state = adapter.state()
            if state is not None and state.received_at != last_state:
                connection.send(("state", state))
                last_state = state.received_at
            if connection.poll(.005):
                operation, payload = connection.recv()
                if operation == "close":
                    break
                if operation == "publish":
                    sequence, positions, velocities, weight, mode = payload
                    try:
                        adapter.publish(positions, velocities, weight, mode)
                        last_command = (positions, velocities, weight, mode)
                        last_command_at = time.monotonic()
                        connection.send(("published", (sequence, None)))
                    except Exception as exc:
                        connection.send(("published", (sequence, str(exc))))
            # Parent failure must not leave a worker holding positive engagement.
            if last_command and last_command[2] > 0 and time.monotonic() - last_command_at > .25:
                positions, _, _, mode = last_command
                adapter.publish(positions, dict.fromkeys(positions, 0.0), 0.0, mode)
                last_command = None
    except (EOFError, BrokenPipeError):
        pass
    except Exception as exc:
        try:
            connection.send(("error", str(exc)))
        except (EOFError, BrokenPipeError, OSError):
            pass
    finally:
        if last_command and last_command[2] > 0:
            try:
                positions, _, _, mode = last_command
                adapter.publish(positions, dict.fromkeys(positions, 0.0), 0.0, mode)
            except Exception:
                pass
        connection.close()
        # Native teardown can deadlock. The parent enforces a process deadline.
        adapter.close()
