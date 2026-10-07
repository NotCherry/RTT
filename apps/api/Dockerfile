# syntax=docker/dockerfile:1.7
FROM docker.io/library/python:3.11-slim AS dependencies
WORKDIR /app
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
RUN mkdir -p /app/data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# SDK dependencies are cached independently from application source.
FROM dependencies AS robot-dependencies
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential cyclonedds-dev libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN ln -s /usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH)/libddsc.so /usr/lib/libddsc.so
ENV CYCLONEDDS_HOME=/usr
COPY requirements-robot.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements-robot.txt
RUN python -c 'from unitree_sdk2py.idl.default import unitree_hg_msg_dds__LowCmd_; from unitree_sdk2py.utils.crc import CRC; CRC().Crc(unitree_hg_msg_dds__LowCmd_())'

FROM robot-dependencies AS robot
COPY app ./app
COPY tools ./tools

# The simulation target remains available for development-only Compose stacks.
FROM dependencies AS simulation
COPY app ./app
COPY tools ./tools
