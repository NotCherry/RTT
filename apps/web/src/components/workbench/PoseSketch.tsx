export function PoseSketch({ target }: { target: number[] }) {
  const firstAngle = -Math.PI / 2 + (target[0] ?? 0);
  const secondAngle = firstAngle + (target[1] ?? 0);
  const shoulder = {
    x: 29 + Math.cos(firstAngle) * 15,
    y: 25 + Math.sin(firstAngle) * 15,
  };
  const wrist = {
    x: shoulder.x + Math.cos(secondAngle) * 13,
    y: shoulder.y + Math.sin(secondAngle) * 13,
  };
  return (
    <div className="pose-sketch" aria-hidden="true">
      <svg viewBox="0 0 58 50">
        <path d="M8 42h42" />
        <line x1="29" y1="25" x2={shoulder.x} y2={shoulder.y} />
        <line x1={shoulder.x} y1={shoulder.y} x2={wrist.x} y2={wrist.y} />
        <circle cx="29" cy="25" r="3" />
        <circle cx={shoulder.x} cy={shoulder.y} r="2.5" />
        <circle cx={wrist.x} cy={wrist.y} r="2.2" />
      </svg>
    </div>
  );
}
