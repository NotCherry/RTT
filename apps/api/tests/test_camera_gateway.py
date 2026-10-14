import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import pytest
from app.camera_gateway import configured_sources, GatewayCapture, CameraGateway


def test_gateway_configuration_exposes_only_named_supported_sources(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    monkeypatch.setenv("RTT_CAMERA_SOURCES", json.dumps({"side": {"name": "Side view", "url": "rtsp://operator:secret@example.invalid/live"}}))
    response = TestClient(app).get("/api/camera-gateway/sources")
    assert response.json() == {"sources": [{"id": "side", "name": "Side view"}]}
    assert "secret" not in response.text and "example.invalid" not in response.text
    monkeypatch.setenv("RTT_CAMERA_SOURCES", "")
    assert configured_sources() == {}
    with pytest.raises(ValueError, match="Invalid"):
        configured_sources('{"local":{"url":"file:///etc/passwd"}}')
    with pytest.raises(KeyError):
        gateway = CameraGateway()
        try:
            gateway.snapshot("not-configured")
        finally:
            gateway.close()


def test_isolated_gateway_decodes_real_mjpeg_and_releases_process():
    cv2 = pytest.importorskip("cv2")
    import numpy as np
    class Feed(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()
            try:
                for i in range(120):
                    image = np.full((64, 96, 3), i % 100 + 80, np.uint8)
                    _, jpeg = cv2.imencode(".jpg", image)
                    data = jpeg.tobytes()
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(data)).encode() + b"\r\n\r\n" + data + b"\r\n")
                    self.wfile.flush()
                    time.sleep(.03)
            except (BrokenPipeError, ConnectionResetError):
                pass
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Feed)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    capture = GatewayCapture(f"http://127.0.0.1:{server.server_port}/video")
    try:
        first = capture.snapshot()
        assert first["width"] == 96 and first["height"] == 64
        assert first["timing"] == "backend-decode"
        assert first["server_time_ms"] - first["decoded_at_ms"] <= 250
        time.sleep(.12)
        assert capture.snapshot()["sequence"] > first["sequence"]
    finally:
        capture.close()
        server.shutdown()
        server.server_close()
    assert not capture.process.is_alive()
