import { describe, expect, it } from "vitest";
import { formatJointValue, meanAbsoluteError } from "./metrics";

describe("training metrics", () => {
  it("reports mean absolute error across mixed joint values", () => {
    expect(meanAbsoluteError([1, -2, 0.5], [0.5, -1, 0])).toBeCloseTo(2 / 3);
  });

  it("returns 0 for empty targets", () => {
    expect(meanAbsoluteError([], [1, 2])).toBe(0);
    expect(meanAbsoluteError([], [])).toBe(0);
  });

  it("handles missing positions with default 0", () => {
    expect(meanAbsoluteError([1, 1], [0.5])).toBeCloseTo(0.75);
  });

  it("formats revolute and prismatic values in their user-facing units", () => {
    expect(formatJointValue("revolute", Math.PI / 2)).toBe("90.0°");
    expect(formatJointValue("prismatic", 0.1254)).toBe("0.125 m");
  });

  it("formats edge joint values", () => {
    expect(formatJointValue("revolute", 0)).toBe("0.0°");
    expect(formatJointValue("revolute", Math.PI)).toBe("180.0°");
    expect(formatJointValue("prismatic", -0.0014)).toBe("-0.001 m");
    expect(formatJointValue("unknown", 1.234)).toBe("70.7°");
  });
});
