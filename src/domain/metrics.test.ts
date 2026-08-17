import { describe, expect, it } from "vitest";
import { formatJointValue, meanAbsoluteError } from "./metrics";

describe("training metrics", () => {
  it("reports mean absolute error across mixed joint values", () => {
    expect(meanAbsoluteError([1, -2, 0.5], [0.5, -1, 0])).toBeCloseTo(2 / 3);
  });

  it("formats revolute and prismatic values in their user-facing units", () => {
    expect(formatJointValue("revolute", Math.PI / 2)).toBe("90.0°");
    expect(formatJointValue("prismatic", 0.1254)).toBe("0.125 m");
  });
});
