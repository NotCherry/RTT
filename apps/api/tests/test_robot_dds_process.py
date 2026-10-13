import os
import time
import pytest
import multiprocessing
from app.robot_dds import ArmState
from app.robot_dds_process import ProcessDDSAdapter
from app.robot_motion import arm_names
from app.robot_transport_contract import ConnectionConfig
from app.robot_dds_worker import run_dds_worker


def stalled_native_worker(connection, config):
    scenario = config["domain_id"]
    if scenario == 2:
        while True:
            time.sleep(1)
    connection.send(("started", None))
    positions = dict.fromkeys(arm_names(config["robot_model"]), .2)
    while True:
        connection.send(("state", ArmState(positions, time.monotonic(), 11)))
        if connection.poll(.02):
            operation, payload = connection.recv()
            if operation == "close" or (operation == "publish" and scenario == 1):
                while True:
                    time.sleep(1)
            if operation == "publish":
                if scenario == 3:
                    os._exit(7)
                connection.send(("published", (payload[0], None)))


def adapter_for(scenario):
    return ProcessDDSAdapter(ConnectionConfig(network_interface="lo", domain_id=scenario),
        worker_target=stalled_native_worker, start_timeout=2, publish_timeout=.1, close_timeout=.1)


def test_native_teardown_deadlock_is_terminated_without_losing_reconnect():
    adapter = adapter_for(0)
    adapter.start()
    try:
        adapter.publish({"left_elbow_joint": .2}, {}, 0, 11)
        assert adapter.state().mode_machine == 11
        started = time.monotonic()
        adapter.close()
        assert time.monotonic() - started < 1.5
        assert not adapter.process.is_alive()
        assert adapter.state() is None
        replacement = adapter_for(0)
        replacement.start()
        replacement.close()
        assert not replacement.process.is_alive()
    finally:
        adapter.close()


@pytest.mark.parametrize("scenario", [1, 3])
def test_stalled_or_crashed_publication_invalidates_state_and_ends_worker(scenario):
    adapter = adapter_for(scenario)
    adapter.start()
    try:
        started = time.monotonic()
        with pytest.raises(RuntimeError, match="DDS"):
            adapter.publish({"left_elbow_joint": .2}, {}, .1, 11)
        assert time.monotonic() - started < 1.5
        assert adapter.state() is None
    finally:
        adapter.close()
    assert not adapter.process.is_alive()


def test_stalled_startup_is_bounded_and_process_is_reaped():
    adapter = adapter_for(2)
    with pytest.raises(RuntimeError, match="initialization timed out"):
        adapter.start()
    assert not adapter.process.is_alive()
    adapter.close()


def reporting_worker(connection, config):
    class ReportingAdapter:
        def __init__(self, config): pass
        def start(self): pass
        def state(self): return None
        def publish(self, positions, velocities, weight, mode):
            connection.send(("observed_weight", weight))
        def close(self): pass
    run_dds_worker(connection, config, ReportingAdapter)


def test_worker_releases_engagement_when_parent_commands_stop():
    context = multiprocessing.get_context("spawn")
    connection, child = context.Pipe()
    process = context.Process(target=reporting_worker,
        args=(child, ConnectionConfig(network_interface="lo").model_dump()), daemon=True)
    process.start()
    child.close()
    try:
        assert connection.poll(2)
        assert connection.recv()[0] == "started"
        assert not connection.poll(.05), "Startup must not publish a motor command"
        connection.send(("publish", (1, {"left_elbow_joint": .2}, {}, .5, 11)))
        weights = []
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            if connection.poll(.05):
                operation, value = connection.recv()
                if operation == "observed_weight":
                    weights.append(value)
                    if value == 0:
                        break
        assert weights == [.5, 0]
        connection.send(("close", None))
        process.join(timeout=1)
        assert not process.is_alive()
    finally:
        connection.close()
        if process.is_alive():
            process.terminate()
        process.join(timeout=1)
