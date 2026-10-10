"""Explicit CycloneDDS configuration for the pinned Unitree channel factory."""
from xml.sax.saxutils import escape
from importlib import import_module


def channel_config(interface, peers=(), allow_multicast=True):
    interface = escape(interface, {'"': "&quot;"})
    peer_xml = "".join(f'<Peer Address="{escape(peer)}"/>' for peer in peers)
    discovery = (f'<Discovery><ParticipantIndex>auto</ParticipantIndex><Peers>{peer_xml}</Peers></Discovery>'
                 if peers else "")
    return ('<CycloneDDS><Domain><General><Interfaces>'
            f'<NetworkInterface name="{interface}" prefer_multicast="false"/>'
            '</Interfaces>'
            '<MaxMessageSize>1400B</MaxMessageSize><MaxRexmitMessageSize>1400B</MaxRexmitMessageSize>'
            '<FragmentSize>1200B</FragmentSize>'
            f'<AllowMulticast>{str(allow_multicast).lower()}</AllowMulticast>'
            f'</General>{discovery}</Domain></CycloneDDS>')


def initialize_sdk_channels(domain, interface, peers=(), allow_multicast=True):
    channel = import_module("unitree_sdk2py.core.channel")
    # The pinned factory passes its XML directly to Domain, bypassing
    # CYCLONEDDS_URI. Supply its existing configuration seam under the caller's
    # factory lock, then restore the SDK template for unrelated users.
    previous = getattr(channel, "ChannelConfigHasInterface", None)
    channel.ChannelConfigHasInterface = channel_config(interface, peers, allow_multicast)
    try:
        channel.ChannelFactoryInitialize(domain, interface)
    finally:
        if previous is None:
            del channel.ChannelConfigHasInterface
        else:
            channel.ChannelConfigHasInterface = previous
