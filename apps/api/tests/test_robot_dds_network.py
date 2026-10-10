import sys
import types
import xml.etree.ElementTree as ET
import pytest
from app.robot_dds_network import channel_config, initialize_sdk_channels
from app.robot_transport_contract import ConnectionConfig


def test_explicit_peers_and_packet_sizes_are_in_the_xml_given_to_the_sdk(monkeypatch):
    channel = types.ModuleType("unitree_sdk2py.core.channel")
    channel.ChannelConfigHasInterface = "original"
    channel.ChannelFactoryInitialize = lambda *_: None
    monkeypatch.setitem(sys.modules, "unitree_sdk2py.core.channel", channel)
    captured = []
    original = channel.ChannelConfigHasInterface
    monkeypatch.setattr(channel, "ChannelFactoryInitialize", lambda *_: captured.append(channel.ChannelConfigHasInterface))
    initialize_sdk_channels(42, "lo", ["127.0.0.1"], False)
    xml = ET.fromstring(captured[0])
    assert xml.find(".//NetworkInterface").attrib["name"] == "lo"
    assert xml.find(".//Peer").attrib["Address"] == "127.0.0.1"
    assert xml.findtext(".//ParticipantIndex") == "auto"
    assert xml.findtext(".//AllowMulticast") == "false"
    assert xml.findtext(".//MaxMessageSize") == "1400B"
    assert xml.find(".//Tracing") is None
    assert channel.ChannelConfigHasInterface == original


def test_sdk_template_is_restored_even_when_initialization_fails(monkeypatch):
    module = types.ModuleType("unitree_sdk2py.core.channel")
    module.ChannelConfigHasInterface = "original"
    def fail(*_):
        raise RuntimeError("init failed")
    module.ChannelFactoryInitialize = fail
    monkeypatch.setitem(sys.modules, "unitree_sdk2py.core.channel", module)
    with pytest.raises(RuntimeError, match="init failed"):
        initialize_sdk_channels(42, "lo")
    assert module.ChannelConfigHasInterface == "original"


@pytest.mark.parametrize("peer", ["robot.local", "192.168.1.999", '<Peer Address="bad"/>', ""])
def test_discovery_peers_reject_hostnames_and_invalid_addresses(peer):
    with pytest.raises(ValueError):
        ConnectionConfig(network_interface="lo", discovery_peers=[peer])


def test_discovery_peers_are_deduplicated():
    config = ConnectionConfig(network_interface="lo", discovery_peers=["127.0.0.1", "127.0.0.1"])
    assert config.discovery_peers == ["127.0.0.1"]


def test_multicast_remains_enabled_by_default_and_interface_is_escaped():
    xml = ET.fromstring(channel_config('Wi-Fi & "lab"'))
    assert xml.find(".//NetworkInterface").attrib["name"] == 'Wi-Fi & "lab"'
    assert xml.findtext(".//AllowMulticast") == "true"
    assert xml.find(".//Peers") is None


@pytest.mark.parametrize("url", [None, "http://robot:9090", "ws://user:pass@robot:9090", "ws://"])
def test_ros_bridge_requires_an_explicit_websocket_endpoint(url):
    with pytest.raises(ValueError):
        ConnectionConfig(transport="unitree-rosbridge", network_interface="lo", rosbridge_url=url)
