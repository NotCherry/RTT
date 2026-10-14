import { useState, type Dispatch, type SetStateAction } from "react";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H3 } from "@/components/ui/typography";
import type { Joint, LandmarkFrame } from "@/types";
import type { RetargetingProfile } from "@/domain/retargeting";
import { MappingInspector } from "./MappingInspector";
import { StickFigure } from "./StickFigure";
import type { useCameraCapture } from "./useCameraCapture";
import { CameraDeviceSelect, type CameraRig } from "./CameraRigControls";

type Props = {
  source: "local" | "ip";
  setSource: Dispatch<SetStateAction<"local" | "ip">>;
  address: string;
  setAddress: Dispatch<SetStateAction<string>>;
  processing: "live" | "offline";
  setProcessing: Dispatch<SetStateAction<"live" | "offline">>;
  setMode: Dispatch<SetStateAction<"simple" | "continuous">>;
  camera: ReturnType<typeof useCameraCapture>;
  latest: LandmarkFrame | null;
  joints: Joint[];
  profile: RetargetingProfile;
  locked: boolean;
  disabled: boolean;
  onToggle: () => void;
  rig?: CameraRig;
  showSettings?: boolean;
  showAction?: boolean;
};
export function CameraSourcePanel({
  source,
  setSource,
  address,
  setAddress,
  processing,
  setProcessing,
  setMode,
  camera,
  latest,
  joints,
  profile,
  locked,
  disabled,
  onToggle,
  rig,
  showSettings = true,
  showAction = true,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const width = (source === "local" ? camera.videoRef.current?.videoWidth : camera.imageRef.current?.naturalWidth) || 640;
  const height = (source === "local" ? camera.videoRef.current?.videoHeight : camera.imageRef.current?.naturalHeight) || 480;
  return (
    <Panel className={`route-viewport-panel camera-source-panel${expanded ? " camera-source-expanded" : ""}`}>
      <PanelHeader>
        <div>
          <PanelLabel>CAMERA</PanelLabel>
          <H3>Live preview</H3>
        </div>
        <Button variant="secondary" aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Reduce camera" : "Expand camera"}
        </Button>
      </PanelHeader>
      <div className={showSettings ? "route-form-grid" : "hidden"}>
        <label>
          Video source
          <select
            aria-label="Video source"
            value={source}
            disabled={locked || camera.connected}
            onChange={(event) => setSource(event.target.value as typeof source)}
          >
            <option value="local">Laptop / USB camera</option>
            <option value="ip">Android IP camera</option>
          </select>
        </label>
        {source === "ip" && (
          <label>
            IP camera URL
            <input
              aria-label="IP camera URL"
              value={address}
              disabled={locked || camera.connected}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="http://192.168.1.20:8080/video"
            />
          </label>
        )}
        {rig && source==="local" && <CameraDeviceSelect rig={rig} index={0} disabled={locked || camera.connected}/>}
        <label>
          Processing
          <select
            aria-label="Processing mode"
            value={processing}
            disabled={locked || camera.connected}
            onChange={(event) => {
              setProcessing(event.target.value as typeof processing);
              if (event.target.value === "offline") setMode("continuous");
            }}
          >
            <option value="live">Live preview</option>
            <option value="offline">Record then process</option>
          </select>
        </label>
      </div>
      <div className="camera-live-preview">
        <video ref={camera.videoRef} muted playsInline className={source === "local" ? "camera-live-media" : "hidden"} />
        <img ref={camera.imageRef} alt="IP camera stream" className={source === "ip" ? "camera-live-media" : "hidden"} />
        {processing === "live" && camera.connected && <StickFigure
          frame={rig?.latest[0] ?? latest}
          overlay
          showSides
          width={width}
          height={height}
        />}
      </div>
      <p className="camera-framing-status">
        {camera.connected ? `${width} × ${height} · entire camera frame` : "Entire camera frame · no crop or zoom"}.
        Unmirrored: L and R mark your own left and right.
      </p>
      {processing === "live" && <MappingInspector frame={latest} joints={joints} profile={profile} />}
      <div className={showAction ? "route-actions" : "hidden"}>
        <Button disabled={disabled || locked} onClick={onToggle}>
          {camera.connected ? "Close camera" : "Open camera"}{rig && rig.inputs.length>1 ? "s" : ""}
        </Button>
      </div>
      {processing === "offline" && <p className="helper-text">Capture video first. Extract its landmarks from Recordings when you are ready.</p>}
      {source === "ip" && (
        <p className="helper-text">IP capture requires a browser-readable stream with CORS enabled on the camera.</p>
      )}
    </Panel>
  );
}
