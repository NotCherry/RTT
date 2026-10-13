#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
command_options=()
if [[ "${FORWARD_COMMANDS:-false}" == "true" ]]; then
    command_options+=(--forward-commands)
fi
exec "${DDS_PYTHON:?Set DDS_PYTHON to the pinned SDK environment}" tools/unitree_dds_relay.py \
    --robot-interface "${ROBOT_INTERFACE:?}" --client-interface "${CLIENT_INTERFACE:?}" \
    --client-domain "${CLIENT_DOMAIN:-7}" --client-peer "${CLIENT_PEER:?}" \
    --report /run/rtt-unitree-dds-relay/status.json "${command_options[@]}"
