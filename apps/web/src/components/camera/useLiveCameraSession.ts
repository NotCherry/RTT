import { useEffect, useRef, useState } from "react";
import { waitForLiveReadiness } from "@/domain/liveSessionStart";
import type { RobotConnectionConfig } from "@/domain/robotTransport";
import type { useRobotTransport } from "./useRobotTransport";

type Options = {
  cameraConnected: boolean;
  openCamera: () => Promise<boolean | undefined>;
  closeCamera: () => void;
  connection: ReturnType<typeof useRobotTransport>;
  liveProcessing: boolean;
  trackingFresh: () => boolean;
};
export function useLiveCameraSession(options: Options) {
  const current = useRef(options);
  current.current = options;
  const attempt = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; attempt.current?.abort(); current.current.connection.cancelPendingConnect(); };
  }, []);
  async function start(settings?: RobotConnectionConfig) {
    if (attempt.current) return;
    const controller = new AbortController();
    attempt.current = controller;
    setBusy(true);
    setError("");
    let createdConnection = false;
    let armRequested = false;
    try {
      const signal = controller.signal;
      if (!current.current.liveProcessing) throw new Error("Select Live preview processing in Camera setup before starting live control.");
      if (!current.current.cameraConnected) {
        setStage("Opening cameras and starting live processing…");
        // Timeout/cancellation closes the underlying hooks, which invalidate delayed getUserMedia/model results.
        let opened = false, failed = false;
        void current.current.openCamera().then(result => { opened = result === true; failed = !opened; }).catch(() => { failed = true; });
        try {
          await waitForLiveReadiness(() => opened || failed, signal, "Camera startup timed out. Check permission and selected sources.", 30000);
          if (!opened) throw new Error("Cameras could not start. Check the source status in Camera setup.");
        } catch (failure) { current.current.closeCamera(); throw failure; }
      }
      signal.throwIfAborted();
      if (settings) {
        const c = current.current.connection;
        if (c.status?.connected && !c.owned) throw new Error("Another browser owns the robot connection.");
        if (!c.status?.connected) {
          setStage("Connecting robot…");
          createdConnection = true;
          if (!await c.connect(settings)) throw new Error("Robot connection failed. Check robot settings and connection status.");
        }
        signal.throwIfAborted();
        setStage("Waiting for fresh tracking, robot state and target stream…");
        await waitForLiveReadiness(() => {
          const latest = current.current;
          return latest.cameraConnected && latest.trackingFresh() && latest.connection.owned
            && latest.connection.streamReady && Boolean(latest.connection.status?.state_fresh)
            && Object.keys(latest.connection.status?.camera_target ?? {}).length > 0;
        }, signal, "Live control is not ready. Check visible landmarks, measured robot state and the target stream.");
        signal.throwIfAborted();
        setStage("Engaging live control…");
        armRequested = true;
        if (!await current.current.connection.action("arm")) throw new Error("Robot could not arm. Check its measured state.");
        signal.throwIfAborted();
      }
      if (mounted.current) setStage(settings ? "Live robot control started" : "Live preview ready");
    } catch (failure) {
      if (armRequested) await current.current.connection.action("disarm");
      if (createdConnection) await current.current.connection.action("disconnect");
      if (mounted.current) {
        setStage("");
        setError(controller.signal.aborted ? "Startup cancelled. No new live control session was started." : failure instanceof Error ? failure.message : "Session startup failed");
      }
    } finally {
      if (attempt.current === controller) attempt.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  return { busy, stage, error, start,
    cancel() { attempt.current?.abort(); current.current.connection.cancelPendingConnect(); },
  };
}
