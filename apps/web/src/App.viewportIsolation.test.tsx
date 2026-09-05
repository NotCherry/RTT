// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import appSrc from "./App.tsx?raw";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - node fs types not in web tsconfig, but available at runtime
import { readFileSync } from "node:fs";
// @ts-ignore
import { resolve } from "node:path";
const stylesSrc = (() => {
  try {
    return readFileSync(resolve("src/styles.css"), "utf8");
  } catch {
    try {
      return readFileSync(resolve("apps/web/src/styles.css"), "utf8");
    } catch {
      return "";
    }
  }
})();

describe("viewport isolation — review fixes", () => {
  it("stabilizes stopReplay with useCallback and exhaustive deps", () => {
    const src = appSrc;
    expect(src).toContain("useCallback");
    expect(src).toContain("const clearPreview = useCallback");
    expect(src).toContain("const stopReplay = useCallback");
    expect(src).toContain("useEffect(() => () => stopReplay(), [stopReplay])");
    expect(src).toContain("[location.pathname, stopReplay]");
  });

  it("clears timeline draft state when leaving timeline route", () => {
    const src = appSrc;
    expect(src).toContain("setTimelineDraft(null)");
    expect(src).toContain("setTimelineDraftSourceId(null)");
    expect(src).toContain("setSelectedFrameIndex(0)");
    expect(src).toContain("setTimelinePlayheadFrame(0)");
    expect(src).toContain("setTimelinePendingPositions(null)");
    expect(src).toContain("setTimelineInsertFrame(null)");
  });

  it("stops replay on preview entry points without breaking replay loops", () => {
    const src = appSrc;
    expect(src).toMatch(/function previewTimelineFrame[\s\S]*stopReplay\(\)/);
    expect(src).toMatch(/function selectTimelineFrame[\s\S]*stopReplay\(\)/);
    expect(src).toMatch(/function scrubTimelineFrame[\s\S]*stopReplay\(\)/);
    expect(src).toContain("function replayFrames");
    expect(src).toContain("function replayDemonstration");
    expect(src).toContain("function applyPreviewPositions");
    const applyBlock = src.slice(src.indexOf("function applyPreviewPositions"), src.indexOf("function applyPreviewPositions") + 300);
    expect(applyBlock).not.toContain("stopReplay()");
  });

  it("does not force horizontal scroll on mobile channel rows", () => {
    const css = stylesSrc;
    expect(css).not.toContain("min-w-[520px]");
    expect(css).toContain("min-w-0");
    expect(css).toContain("110px minmax(0, 1fr)");
  });

  it("coord display is not gratuitously wrapped (scope-creep guard)", () => {
    const src = appSrc;
    expect(src).toContain("<b>{rolloutDiagnostics.coordination.simultaneity.toFixed(2)}</b>");
    expect(src).not.toContain("simultaneity.toFixed(\n");
  });
});
