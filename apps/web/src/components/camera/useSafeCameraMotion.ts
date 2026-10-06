import { useEffect, useRef, useState } from "react";
import type { Joint, LandmarkFrame } from "@/types";
import { retargetLandmarkFrame, type RetargetingProfile } from "@/domain/retargeting";
import { CAMERA_STALE_MS, createMotionGuard, observeMotion, stepMotion } from "@/domain/cameraMotionSafety";

export function useSafeCameraMotion(joints: Joint[], neutral: number[], profile: RetargetingProfile, onPreview: (q: number[]) => void, positions = neutral) {
  const guard = useRef(createMotionGuard(positions));
  const last = useRef([...positions]);
  const current = useRef({ joints, neutral, profile, onPreview, positions });
  current.current = { joints, neutral, profile, onPreview, positions };
  const [status, setStatus] = useState("Motion held · last position");
  useEffect(() => {
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const g = guard.current;
      const next = stepMotion(g, current.current.joints, now, now - previous);
      previous = now;
      if (next.some((q, i) => q !== last.current[i])) {
        last.current = next;
        current.current.onPreview(next);
      }
      const fresh = Boolean(g.target) && now - g.receivedAt <= CAMERA_STALE_MS;
      setStatus(g.paused ? fresh ? "Motion paused · tracking changed; check the person before resuming" : "Motion paused · waiting for visible tracking before resume"
        : !fresh ? "Motion held · last position"
        : "Bounded motion · maximum 0.5 rad/s");
    }, 1000 / 30);
    return () => clearInterval(timer);
  }, []);
  return {
    status,
    paused: guard.current.paused,
    canResume: Boolean(guard.current.target) && performance.now() - guard.current.receivedAt <= CAMERA_STALE_MS,
    observe(frame: LandmarkFrame | null) {
      const c = current.current;
      if (!guard.current.target && c.positions.length === guard.current.positions.length && c.positions.every(Number.isFinite)) {
        guard.current.positions = [...c.positions];
        last.current = [...c.positions];
      }
      observeMotion(guard.current, frame, frame ? retargetLandmarkFrame(frame, c.joints, c.neutral, c.profile) : null, performance.now());
    },
    resume() {
      const g = guard.current;
      if (g.target && performance.now() - g.receivedAt <= CAMERA_STALE_MS) g.paused = false;
    },
  };
}
