import { useEffect, useState } from "react";
import { getCameraGatewaySources } from "@/api";
import { gatewayCameraIdentity } from "@/domain/ipCamera";
export function IPCameraSourceSelect({ address, onChange, disabled, label = "IP camera" }: { address: string; onChange: (value: string) => void; disabled: boolean; label?: string }) {
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { const controller = new AbortController(); void getCameraGatewaySources(controller.signal).then(result => setSources(result.sources)).catch(() => {}); return () => controller.abort(); }, []);
  const identity = gatewayCameraIdentity(address);
  return <><label>IP source<select aria-label={`${label} access`} value={identity ? `gateway:${identity}` : "direct"} disabled={disabled} onChange={e => onChange(e.target.value === "direct" ? "" : e.target.value)}>
    <option value="direct">Browser-readable HTTP/MJPEG stream</option>{sources.map(source => <option key={source.id} value={`gateway:${source.id}`}>Configured · {source.name}</option>)}
    {identity && !sources.some(source => source.id === identity) && <option value={`gateway:${identity}`}>Saved source · {identity} · unavailable</option>}
  </select></label>{!identity && <label>IP camera URL<input aria-label={`${label} URL`} value={address} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder="http://192.168.1.20:8080/video" /></label>}
  {identity && <p className="helper-text">Configured IP camera · credentials and decoding stay on the backend. Exposure timing is unverified.</p>}</>;
}
