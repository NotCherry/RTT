import { useEffect, useRef, useState } from "react";
import type { Joint, LandmarkFrame } from "@/types";
import { retargetLandmarkFrame, type RetargetingProfile } from "@/domain/retargeting";
import { CAMERA_SPEED_LIMIT, CAMERA_STALE_MS, createMotionGuard, observeMotion, stepMotion } from "@/domain/cameraMotionSafety";

export function useSafeCameraMotion(joints: Joint[], neutral: number[], profile: RetargetingProfile, onPreview: (q: number[]) => void, positions = neutral, maxSpeed = CAMERA_SPEED_LIMIT) {
  const initial = joints.map((joint, i) => {
    const value = positions.length === joints.length && Number.isFinite(positions[i]) ? positions[i] : neutral[i];
    return Math.max(joint.lower, Math.min(joint.upper, Number.isFinite(value) ? value : 0));
  });
  const guard = useRef(createMotionGuard(initial));
  const last = useRef([...initial]);
  const current = useRef({ joints, neutral, profile, onPreview, positions, maxSpeed });
  current.current = { joints, neutral, profile, onPreview, positions, maxSpeed };
  const [status, setStatus] = useState("Motion held · last position");
  useEffect(() => {
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const g = guard.current;
      const next = stepMotion(g, current.current.joints, now, now - previous, current.current.maxSpeed);
      previous = now;
      if (next.some((q, i) => q !== last.current[i])) {
        last.current = next;
        current.current.onPreview(next);
      }
      const fresh = Boolean(g.target) && now - g.receivedAt <= CAMERA_STALE_MS;
      setStatus(g.paused ? "Tracking settling · reconnecting automatically"
        : !fresh ? "Motion held · last position"
        : `Following movement · up to ${current.current.maxSpeed} rad/s`);
    }, 1000 / 60);
    return () => clearInterval(timer);
  }, []);
  return {
    status,
    reference: () => [...guard.current.positions],
    observe(frame: LandmarkFrame | null) {
      const c = current.current;
      if (!guard.current.target && c.positions.length === guard.current.positions.length && c.positions.every(Number.isFinite)) {
        guard.current.positions = [...c.positions];
        last.current = [...c.positions];
      }
      observeMotion(guard.current, frame, frame ? retargetLandmarkFrame(frame, c.joints, c.neutral, c.profile) : null, performance.now());
      return guard.current.target;
    },
  };
}
