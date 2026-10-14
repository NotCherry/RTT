export function createImageFreshnessProbe() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const state = { signature: "", changedAt: -Infinity };
  return (image: HTMLImageElement, now: number) => {
    if (!context) return false;
    context.drawImage(image, 0, 0, 32, 32);
    const bytes = context.getImageData(0, 0, 32, 32).data;
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
    return observeImageSignature(state, String(hash), now);
  };
}
export function observeImageSignature(state: { signature: string; changedAt: number }, signature: string, now: number) {
  if (signature !== state.signature) { state.signature = signature; state.changedAt = now; }
  return now-state.changedAt <= 250;
}
