import { useState } from "react";
import { Button } from "@/components/ui";
import { H3 } from "@/components/ui/typography";
import { parseCameraCalibration } from "@/domain/multiCameraContract";
import type { useMultiCameraCapture } from "./useMultiCameraCapture";
import { StickFigure } from "./StickFigure";

export type CameraRig = ReturnType<typeof useMultiCameraCapture>["rig"];
export function CameraDeviceSelect({
  rig,
  index,
  disabled,
}: {
  rig: CameraRig;
  index: number;
  disabled: boolean;
}) {
  return (
    <label>
      USB camera {index + 1}
      <select
        aria-label={`USB camera ${index + 1}`}
        value={rig.inputs[index].deviceId}
        disabled={disabled}
        onChange={(event) =>
          rig.update(index, { deviceId: event.target.value })
        }
      >
        <option value="">
          {rig.inputs.length === 1 ? "Default camera" : "Choose a camera"}
        </option>
        {rig.devices.map((device, i) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `Camera device ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CameraRigControls({
  rig,
  disabled,
}: {
  rig: CameraRig;
  disabled: boolean;
}) {
  const [error, setError] = useState("");
  const multi = rig.inputs.length > 1;
  return (
    <div className="camera-rig-controls">
      <div className="route-actions">
        <Button
          variant="secondary"
          disabled={disabled || rig.inputs.length === 3}
          onClick={rig.add}
        >
          Add camera
        </Button>
        {multi && (
          <Button variant="secondary" disabled={disabled} onClick={rig.remove}>
            Remove last camera
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => void rig.refreshDevices()}
        >
          Detect cameras
        </Button>
      </div>
      {multi && (
        <>
          <div className="route-form-grid">
            <label>
              Pose model
              <select
                aria-label="Multi-camera pose model"
                value={rig.model}
                disabled={disabled}
                onChange={(event) =>
                  rig.setModel(event.target.value as typeof rig.model)
                }
              >
                <option value="body-aligned">
                  MediaPipe + body-aligned fusion
                </option>
                <option value="triangulated">
                  MediaPipe + calibrated 3D triangulation
                </option>
              </select>
            </label>
            {rig.model === "triangulated" && (
              <label>
                Camera calibration
                <input
                  aria-label="Camera calibration JSON"
                  type="file"
                  accept="application/json,.json"
                  disabled={disabled}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      if (file.size > 65536)
                        throw new Error("Calibration file is too large.");
                      rig.setCalibration(
                        parseCameraCalibration(JSON.parse(await file.text())),
                      );
                      setError("");
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "Invalid calibration.",
                      );
                    }
                  }}
                />
              </label>
            )}
          </div>
          <p className="helper-text">
            {rig.model === "body-aligned"
              ? "Show the same person’s shoulders and hips in each view. Confident body landmarks are aligned and combined to recover occluded limbs. Depth remains a model estimate."
              : "Import a checkerboard calibration from this camera arrangement. Keep cameras fixed at the calibrated resolution. A joint needs two matching views to reconstruct depth."}
          </p>
          {rig.model === "triangulated" && (
            <p className="helper-text">
              {rig.calibration
                ? `${rig.calibration.cameras.length} calibrated cameras loaded.`
                : "Record a checkerboard clip in every view and export the camera videos from Recordings. Import the calibration result before using triangulation."}
            </p>
          )}
          {error && (
            <p role="alert" className="helper-text">
              {error}
            </p>
          )}
          <div className="camera-supplementary-views">
            {rig.inputs.slice(1).map((input, offset) => {
              const index = offset + 1,
                camera = rig.cameras[index];
              const width =
                (input.kind === "local"
                  ? camera.videoRef.current?.videoWidth
                  : camera.imageRef.current?.naturalWidth) || 640;
              const height =
                (input.kind === "local"
                  ? camera.videoRef.current?.videoHeight
                  : camera.imageRef.current?.naturalHeight) || 480;
              return (
                <section
                  key={input.id}
                  aria-label={`Camera ${index + 1} view`}
                  className="camera-supplementary-view"
                >
                  <div className="route-form-grid">
                    <H3>Camera {index + 1}</H3>
                    <label>
                      Video source
                      <select
                        aria-label={`Camera ${index + 1} source`}
                        value={input.kind}
                        disabled={disabled}
                        onChange={(event) =>
                          rig.update(index, {
                            kind: event.target.value as typeof input.kind,
                          })
                        }
                      >
                        <option value="local">Laptop / USB camera</option>
                        <option value="ip">Android IP camera</option>
                      </select>
                    </label>
                    {input.kind === "local" ? (
                      <CameraDeviceSelect
                        rig={rig}
                        index={index}
                        disabled={disabled}
                      />
                    ) : (
                      <label>
                        IP camera URL
                        <input
                          aria-label={`Camera ${index + 1} IP URL`}
                          value={input.address}
                          disabled={disabled}
                          onChange={(event) =>
                            rig.update(index, { address: event.target.value })
                          }
                        />
                      </label>
                    )}
                  </div>
                  <div className="camera-live-preview">
                    <video
                      ref={camera.videoRef}
                      muted
                      playsInline
                      className={
                        input.kind === "local" ? "camera-live-media" : "hidden"
                      }
                    />
                    <img
                      ref={camera.imageRef}
                      alt={`Camera ${index + 1} IP stream`}
                      className={
                        input.kind === "ip" ? "camera-live-media" : "hidden"
                      }
                    />
                    {camera.connected && (
                      <StickFigure
                        frame={rig.latest[index]}
                        overlay
                        showSides
                        width={width}
                        height={height}
                      />
                    )}
                  </div>
                  <p className="camera-framing-status">
                    {camera.status} · entire frame · unmirrored.
                  </p>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
