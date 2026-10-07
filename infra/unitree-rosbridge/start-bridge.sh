#!/usr/bin/env bash
set -eo pipefail
source /opt/ros/humble/setup.bash
source /opt/unitree_ws/install/setup.bash
exec ros2 launch rosbridge_server rosbridge_websocket_launch.xml \
    address:="${ROSBRIDGE_ADDRESS:-192.168.123.164}" port:=9090 \
    topics_glob:="'[/lowstate,/arm_sdk,/rtt/bridge_probe]'" \
    topics_pub_glob:="'[/arm_sdk,/rtt/bridge_probe]'" \
    topics_sub_glob:="'[/lowstate,/arm_sdk,/rtt/bridge_probe]'" \
    services_glob:="'[/rosapi/*]'" params_glob:="'[/rtt/no_parameters]'"
