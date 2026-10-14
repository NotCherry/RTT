export function gatewayCameraIdentity(value: string) {
  return /^gateway:([a-z][a-z0-9_-]{0,31})$/.exec(value)?.[1] ?? null;
}
export function directIpCameraStreamUrl(value: string) {
  if (gatewayCameraIdentity(value)) return value;
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use an HTTP/MJPEG browser stream or choose a configured IP camera for RTSP.");
  if (url.username || url.password) throw new Error("Keep camera credentials on the backend; choose a configured IP camera.");
  if (url.pathname === "" || url.pathname === "/") url.pathname = "/video/mjpeg";
  return url.toString();
}
