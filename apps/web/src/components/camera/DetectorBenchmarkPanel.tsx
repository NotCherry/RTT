import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { benchmarkCameraDetectors, type DetectorBenchmarkResult } from "@/domain/cameraDetectorBenchmark";
import type { CameraRecording } from "@/domain/cameraArchive";
export function DetectorBenchmarkPanel({ recording, blocked, onBusyChange }: { recording: CameraRecording; blocked: boolean; onBusyChange: (busy: boolean) => void }) {
  const [results, setResults] = useState<DetectorBenchmarkResult[]>([]), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => { setResults([]); setError(""); return () => { abort.current?.abort(); abort.current = null; }; }, [recording.id]);
  async function start() {
    if (abort.current) return;
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError(""); setResults([]); setProgress(0);
    try {
      const value = await benchmarkCameraDetectors(recording, controller.signal, setProgress);
      if (abort.current === controller && !controller.signal.aborted) setResults(value);
    } catch (failure) { if (abort.current === controller) setError(controller.signal.aborted ? "Comparison cancelled" : failure instanceof Error ? failure.message : "Comparison failed"); }
    finally { if (abort.current === controller) { abort.current = null; setBusy(false); } }
  }
  function download() {
    const data = { version: 1, recording_id: recording.id, sample_duration_ms: Math.min(3000, recording.duration_ms), browser: navigator.userAgent, results, accuracy: "not measured" };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "camera-detector-comparison.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <details className="camera-mapping-inspector"><summary>Compare landmark detectors on this recording</summary>
    <p className="helper-text">Compare the first three seconds at 10 samples/s using the same retained source pixels. Close live cameras and disconnect robot control first. Processing FPS excludes decoding and model initialization; detection coverage is not an accuracy score.</p>
    <div className="route-actions">{busy ? <Button variant="secondary" onClick={() => abort.current?.abort()}>Cancel comparison · {Math.round(progress)}%</Button>
      : <Button variant="secondary" disabled={blocked || !recording.video} onClick={() => void start()}>Compare detectors</Button>}
      {!!results.length && <Button variant="secondary" onClick={download}>Export comparison</Button>}
    </div>{!!results.length && <div className="overflow-x-auto"><table className="w-full text-left font-mono text-xs"><thead><tr><th>Detector</th><th>Detected / processed</th><th>Mean</th><th>p95</th><th>Processing fps</th></tr></thead><tbody>{results.map(result => <tr key={result.detector}><td>{result.detector}</td><td>{result.detected_frames}/{result.frames}</td><td>{result.mean_processing_ms.toFixed(1)} ms</td><td>{result.p95_processing_ms.toFixed(1)} ms</td><td>{result.worker_fps.toFixed(1)}</td></tr>)}</tbody></table></div>}
    {error && <p role="alert" className="helper-text">{error}</p>}
  </details>;
}
