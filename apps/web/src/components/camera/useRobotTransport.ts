import { useEffect, useRef, useState } from "react";
import { connectRobotTransport, createRobotTargetSocket, getRobotTransportStatus, robotTransportAction, type RobotConnectionConfig, type RobotTransportStatus } from "@/domain/robotTransport";
import { selectRobotTargets } from "@/domain/robotControlMapping";
import type { Joint } from "@/types";

export function useRobotTransport() {
  const [status, setStatus] = useState<RobotTransportStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [owned, setOwned] = useState(false);
  const [streamReady, setStreamReady] = useState(false);
  const [controlJoints, setControlJoints] = useState<Joint[] | null>(null);
  const token = useRef("");
  const config = useRef<RobotConnectionConfig | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const ready = useRef(false);
  const sequence = useRef(0);
  const clockOffset = useRef(0);
  const congestedAt = useRef<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let polling = false;
    const unavailable = "Robot backend is not responding. Measured state is unavailable.";
    const poll = () => {
      if (polling) return;
      polling = true;
      void getRobotTransportStatus().then(next => {
        if (mounted.current) {
          setStatus(next);
          setError(previous => previous === unavailable ? "" : previous);
        }
      }).catch(() => {
        if (mounted.current) {
          setError(unavailable);
          setStatus(previous => previous ? { ...previous, state_fresh: false, measured: {}, camera_target: {}, reason: unavailable } : null);
        }
      }).finally(() => { polling = false; });
    };
    poll();
    const timer = setInterval(poll, 500);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      const stream = socket.current;
      socket.current = null;
      stream?.close();
      const owner = token.current;
      if (owner) void robotTransportAction("disconnect", owner).catch(() => {});
    };
  }, []);
  async function operate(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await action(); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "Robot connection failed"); }
    finally { if (mounted.current) setBusy(false); }
  }
  return {
    status, error, busy, owned, streamReady, controlJoints,
    connect: (settings: RobotConnectionConfig) => operate(async () => {
      ready.current = false;
      setStreamReady(false);
      const next = await connectRobotTransport(settings);
      if (!mounted.current) { await robotTransportAction("disconnect", next.token); return; }
      token.current = next.token;
      config.current = settings;
      setControlJoints(next.joint_contract ?? null);
      sequence.current = 0;
      congestedAt.current = null;
      setOwned(true);
      setStatus(next);
      let stream: WebSocket;
      try { stream = createRobotTargetSocket(); }
      catch (failure) {
        await robotTransportAction("disconnect", next.token);
        token.current = "";
        setOwned(false);
        setStatus(previous => previous ? { ...previous, connected: false, armed: false } : null);
        throw failure;
      }
      socket.current = stream;
      stream.onopen = () => stream.send(JSON.stringify({ token: next.token }));
      stream.onmessage = event => {
        const response = JSON.parse(event.data);
        ready.current = response.ready === true;
        if (mounted.current) setStreamReady(ready.current);
        if (ready.current && Number.isFinite(response.server_time_ms)) clockOffset.current = response.server_time_ms - Date.now();
        if (response.error && mounted.current) setError(response.error);
      };
      stream.onerror = () => { if (mounted.current) setError("Robot target stream failed"); };
      stream.onclose = () => {
        if (socket.current !== stream) return;
        // A failed handshake may never attach a server-side stream owner.
        void robotTransportAction("disconnect", next.token).catch(() => {});
        ready.current = false;
        token.current = "";
        if (mounted.current) {
          setOwned(false);
          setControlJoints(null);
          setStreamReady(false);
          setStatus(previous => previous ? { ...previous, connected: false, armed: false, reason: "Camera stream disconnected · disarmed" } : null);
        }
      };
    }),
    action: (action: "arm" | "disarm" | "disconnect") => operate(async () => {
      const next = await robotTransportAction(action, token.current);
      if (mounted.current) setStatus(next);
      if (action === "disconnect") {
        token.current = "";
        ready.current = false;
        const stream = socket.current;
        socket.current = null;
        stream?.close();
        if (mounted.current) setOwned(false);
        if (mounted.current) setControlJoints(null);
        if (mounted.current) setStreamReady(false);
      }
    }),
    submit(positions: Record<string, number> | null) {
      const stream = socket.current;
      if (!ready.current || stream?.readyState !== WebSocket.OPEN) return;
      // A single pending browser write is normal; drop this frame, never queue it.
      if (stream.bufferedAmount > 0) {
        const now = performance.now();
        congestedAt.current ??= now;
        if (now - congestedAt.current >= 250) {
          setError("Robot target stream remained congested for 250 ms; disconnected and disarmed.");
          stream.close();
        }
        return;
      }
      congestedAt.current = null;
      const target = selectRobotTargets(positions, config.current);
      stream.send(JSON.stringify({ sequence: sequence.current++, sent_at_ms: Date.now() + clockOffset.current, tracking: Boolean(target), positions: target ?? {} }));
    },
  };
}
