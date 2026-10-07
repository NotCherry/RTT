FROM ros:humble-ros-base

ARG UNITREE_ROS_REV=668d1ec5a05d1c38d3306bdca7d59f2ba3581a88
SHELL ["/bin/bash", "-c"]
RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential python3-colcon-common-extensions \
    ros-humble-rosbridge-server ros-humble-rmw-cyclonedds-cpp \
    ros-humble-rosidl-generator-dds-idl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/unitree_ws
RUN git init /tmp/unitree_ros2 \
    && git -C /tmp/unitree_ros2 remote add origin https://github.com/unitreerobotics/unitree_ros2.git \
    && git -C /tmp/unitree_ros2 fetch --depth 1 origin "$UNITREE_ROS_REV" \
    && git -C /tmp/unitree_ros2 checkout --detach FETCH_HEAD \
    && mkdir src \
    && cp -r /tmp/unitree_ros2/cyclonedds_ws/src/unitree/unitree_hg src/ \
    && source /opt/ros/humble/setup.bash \
    && colcon build --packages-select unitree_hg --cmake-args -DBUILD_TESTING=OFF \
    && rm -rf /tmp/unitree_ros2 build log
COPY cyclonedds.xml /etc/rtt/cyclonedds.xml
COPY start-bridge.sh /usr/local/bin/start-rtt-rosbridge
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp ROS_DOMAIN_ID=0 \
    CYCLONEDDS_URI=file:///etc/rtt/cyclonedds.xml ROS_LOCALHOST_ONLY=0
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s \
    CMD python3 -c 'import os,socket; socket.create_connection((os.getenv("ROSBRIDGE_ADDRESS", "192.168.123.164"),9090),2).close()'
ENTRYPOINT ["/bin/bash", "/usr/local/bin/start-rtt-rosbridge"]
