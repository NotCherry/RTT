// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { robotTransportRequest } from "../api";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("bounds stalled robot requests so controls can recover", async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  const pending = robotTransportRequest("status");
  const rejected = expect(pending).rejects.toThrow("request deadline");
  await vi.advanceTimersByTimeAsync(2000);
  await rejected;
});
