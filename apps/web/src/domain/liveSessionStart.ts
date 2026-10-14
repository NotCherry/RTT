export async function waitForLiveReadiness(ready: () => boolean, signal: AbortSignal, message: string, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!ready()) {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise<void>((resolve, reject) => {
      const aborted = () => { clearTimeout(timer); reject(new DOMException("Startup cancelled", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, 50);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
    });
  }
  signal.throwIfAborted();
}
