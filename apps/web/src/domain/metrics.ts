export function formatJointValue(type: string, value: number) {
  return type === "prismatic"
    ? `${value.toFixed(3)} m`
    : `${((value * 180) / Math.PI).toFixed(1)}°`;
}

export function meanAbsoluteError(target: number[], positions: number[]) {
  if (!target.length) return 0;
  return (
    target.reduce(
      (total, value, index) =>
        total + Math.abs(value - (positions[index] ?? 0)),
      0,
    ) / target.length
  );
}
