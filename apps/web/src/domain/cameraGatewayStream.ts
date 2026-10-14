import { getCameraGatewayFrame } from "@/api";
export type GatewayFrame = { epoch: string; sequence: number; jpeg: string; width: number; height: number; source_age_ms: number };
export function openCameraGatewayStream(identity: string, image: HTMLImageElement, onError: (message: string) => void) {
  const controller = new AbortController();
  let closed = false, started = false, lastSequence = -1, epoch = "";
  let resolve!: () => void, reject!: (error: unknown) => void;
  const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  async function poll() {
    try {
      while (!closed) {
        const began = performance.now();
        const packet = await getCameraGatewayFrame<GatewayFrame>(identity, AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]));
        const receivedAt = performance.now();
        if (closed) return;
        if (typeof packet.epoch !== "string" || !Number.isSafeInteger(packet.sequence) || packet.sequence < 0
          || typeof packet.jpeg !== "string" || packet.jpeg.length > 2_000_000 || !Number.isFinite(packet.source_age_ms)
          || packet.source_age_ms < 0 || packet.source_age_ms > 250) throw new Error("IP camera returned an invalid or stale frame");
        if (epoch && epoch !== packet.epoch) throw new Error("IP camera source restarted. Reopen the setup and revalidate calibration.");
        epoch = packet.epoch;
        if (packet.sequence > lastSequence) {
          image.dataset.cameraLoading = "true";
          image.src = `data:image/jpeg;base64,${packet.jpeg}`;
          await image.decode();
          if (closed) return;
          image.dataset.cameraSequence = `${epoch}:${packet.sequence}`;
          image.dataset.cameraSourceAge = String(packet.source_age_ms + receivedAt - began);
          image.dataset.cameraReceivedAt = String(receivedAt);
          image.dataset.cameraLoading = "false";
          lastSequence = packet.sequence;
          if (!started) { started = true; resolve(); }
        }
        await new Promise<void>(done => setTimeout(done, 1000 / 30));
      }
    } catch (error) {
      if (closed) return;
      closed = true; controller.abort();
      const message = error instanceof Error ? error.message : "IP camera source unavailable";
      if (!started) reject(new Error(message)); else onError(message);
    }
  }
  void poll();
  return { ready, close() { closed = true; controller.abort(); reject(new DOMException("Camera source closed", "AbortError"));
    delete image.dataset.cameraSequence; delete image.dataset.cameraSourceAge; delete image.dataset.cameraReceivedAt; delete image.dataset.cameraLoading;
  } };
}
