export function directIpCameraStreamUrl(value: string) {
  const url = new URL(value.trim());
  if (url.pathname === "" || url.pathname === "/") url.pathname = "/video/mjpeg";
  return url.toString();
}
