import type { Dispatch, SetStateAction } from "react";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H3 } from "@/components/ui/typography";
import type { LandmarkFrame } from "@/types";
import { StickFigure } from "./StickFigure";
import type { useCameraCapture } from "./useCameraCapture";

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
  locked: boolean;
  disabled: boolean;
  onToggle: () => void;
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
  locked,
  disabled,
  onToggle,
}: Props) {
  return (
    <Panel className="route-viewport-panel">
      <PanelHeader>
        <div>
          <PanelLabel>CAMERA</PanelLabel>
          <H3>Live preview</H3>
        </div>
      </PanelHeader>
      <div className="route-form-grid">
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
        <video ref={camera.videoRef} muted playsInline className={source === "local" ? "camera-video" : "hidden"} />
        <img ref={camera.imageRef} alt="IP camera stream" className={source === "ip" ? "camera-video" : "hidden"} />
        <StickFigure
          frame={latest}
          overlay
          width={
            (source === "local" ? camera.videoRef.current?.videoWidth : camera.imageRef.current?.naturalWidth) || 640
          }
          height={
            (source === "local" ? camera.videoRef.current?.videoHeight : camera.imageRef.current?.naturalHeight) || 480
          }
        />
      </div>
      <div className="route-actions">
        <Button disabled={disabled || locked} onClick={onToggle}>
          {camera.connected ? "Close camera" : "Open camera"}
        </Button>
      </div>
      {source === "ip" && (
        <p className="helper-text">IP capture requires a browser-readable stream with CORS enabled on the camera.</p>
      )}
    </Panel>
  );
}
