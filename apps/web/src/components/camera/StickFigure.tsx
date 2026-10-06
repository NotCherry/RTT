import type { LandmarkFrame, LandmarkPoint } from "@/types";
const bodyEdges = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [15, 17],
  [15, 19],
  [16, 18],
  [16, 20],
];
const handEdges = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];
function visible(point?: LandmarkPoint) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 1) >= 0.5;
}
export function StickFigure({
  frame,
  overlay = false,
  showSides = false,
  width = 640,
  height = 480,
}: {
  frame: LandmarkFrame | null;
  overlay?: boolean;
  showSides?: boolean;
  width?: number;
  height?: number;
}) {
  return (
    <svg
      className={overlay ? "camera-skeleton-overlay" : "camera-skeleton"}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Extracted stick figure"
    >
      {[frame?.pose ?? [], frame?.left_hand ?? [], frame?.right_hand ?? []].map((points, group) => (
        <g key={group}>
          {(group === 0 ? bodyEdges : handEdges).map(([a, b]) =>
            visible(points[a]) && visible(points[b]) ? (
              <line
                key={`${a}-${b}`}
                x1={points[a].x * width}
                y1={points[a].y * height}
                x2={points[b].x * width}
                y2={points[b].y * height}
              />
            ) : null,
          )}
          {points.map((point, index) =>
            visible(point) ? <circle key={index} cx={point.x * width} cy={point.y * height} r={3} /> : null,
          )}
        </g>
      ))}
      {showSides && [[11, "L"], [12, "R"]].map(([index, label]) => {
        const point = frame?.pose[Number(index)];
        return visible(point) ? <text key={index} className="camera-side-label"
          x={point!.x * width} y={point!.y * height - 12} textAnchor="middle">{label}</text> : null;
      })}
      {!frame && (
        <text x={width / 2} y={height / 2} textAnchor="middle">
          No confident pose at this time
        </text>
      )}
    </svg>
  );
}
