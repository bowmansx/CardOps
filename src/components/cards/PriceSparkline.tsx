// Compact price trend (server-rendered SVG, no chart lib). One gold line + a
// soft area, an end marker, and a start→end tint. Draws nothing until there
// are ≥2 history points. Reuses the value-lab timeline's visual language.
export function PriceSparkline({
  points,
  height = 44,
  className = "",
}: {
  points: { price: number; ts: string }[];
  height?: number;
  className?: string;
}) {
  const pts = points
    .map((p) => ({ price: Number(p.price), t: new Date(p.ts).getTime() }))
    .filter((p) => Number.isFinite(p.price) && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;

  const W = 300, H = height, M = 4;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const span = Math.max(1, t1 - t0);
  const lo = Math.min(...pts.map((p) => p.price));
  const hi = Math.max(...pts.map((p) => p.price));
  const pad = Math.max(0.5, (hi - lo) * 0.15);
  const x = (t: number) => M + ((t - t0) / span) * (W - 2 * M);
  const y = (p: number) => H - M - ((p - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 2 * M);

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const area = `${line} L${x(t1).toFixed(1)},${H - M} L${x(t0).toFixed(1)},${H - M} Z`;
  const up = pts[pts.length - 1].price >= pts[0].price;
  const stroke = up ? "var(--color-pos)" : "var(--color-danger)";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={"w-full " + className} style={{ height }} role="img" aria-label="price trend">
      <path d={area} fill={stroke} fillOpacity="0.1" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(t1)} cy={y(pts[pts.length - 1].price)} r="2.5" fill={stroke} />
    </svg>
  );
}
