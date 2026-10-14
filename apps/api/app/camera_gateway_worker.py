"""Decode one configured IP source in an isolated latest-frame process."""
import os
import queue
import time


def capture_source(url, frames, stop):
    # FFmpeg errors can echo a credential-bearing URL. Keep native stderr private.
    with open(os.devnull, "w") as sink:
        os.dup2(sink.fileno(), 2)
    import cv2
    cv2.setNumThreads(1)
    capture = cv2.VideoCapture()
    try:
        opened = capture.open(url, cv2.CAP_FFMPEG, [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 1000])
        if not opened:
            return
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        sequence = 0
        while not stop.is_set():
            ok, image = capture.read()
            decoded_at_ms = time.time() * 1000
            decoded_monotonic_ms = time.monotonic() * 1000
            if not ok or image is None or max(image.shape[:2]) > 4096:
                return
            ok, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if not ok or jpeg.nbytes > 1_500_000:
                return
            packet = {"sequence": sequence, "decoded_at_ms": decoded_at_ms,
                      "decoded_monotonic_ms": decoded_monotonic_ms,
                      "width": image.shape[1], "height": image.shape[0], "jpeg": jpeg.tobytes()}
            sequence += 1
            try:
                frames.put_nowait(packet)
            except queue.Full:
                try:
                    frames.get_nowait()
                except queue.Empty:
                    pass
                try:
                    frames.put_nowait(packet)
                except queue.Full:
                    pass
    finally:
        capture.release()
