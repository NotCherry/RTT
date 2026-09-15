export function cameraErrorMessage(error: unknown, cameraCount?: number) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission was blocked. Allow camera access for this site in the browser address bar, then reopen the camera.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || cameraCount === 0) {
    return "No enabled camera was found. Open the Lenovo privacy shutter/switch, enable the integrated camera in Windows Settings and Device Manager, then reload this page.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera is busy or its driver is unavailable. Close other camera apps, then check Device Manager for the integrated camera.";
  }
  if (name === "SecurityError") {
    return "Camera access requires a secure HTTPS page (or localhost).";
  }
  return "Camera could not start. Check the browser and Windows camera settings, then try again.";
}
