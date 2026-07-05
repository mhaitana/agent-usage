/**
 * Tiny inline-SVG sparkline — no Recharts overhead. Renders a smooth-ish
 * polyline + a soft area fill, used inside KPI tiles to give recency context.
 * Scales to its viewBox; caller sets width/height via className.
 */
export function Sparkline({
  values,
  width = 120,
  height = 36,
  color = "var(--series-1)",
  ariaLabel,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  ariaLabel: string;
}) {
  if (values.length === 0) return null;

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const n = values.length;

  // Pad the line to the full width so a single-point sparkline still renders.
  const stepX = n > 1 ? (width - 2) / (n - 1) : 0;
  const pts = values.map((v, i) => {
    const x = 1 + i * stepX;
    const y = height - 2 - ((v - min) / span) * (height - 4);
    return [x, y] as const;
  });

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(2)} ${height} L${pts[0][0].toFixed(2)} ${height} Z`;
  // Deterministic id (no Math.random — would break SSR hydration).
  const gradId = `spark-${values.length}-${Math.round(min)}-${Math.round(max)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End-point marker for the "current" value. */}
      <circle
        cx={pts[pts.length - 1][0]}
        cy={pts[pts.length - 1][1]}
        r={2.25}
        fill={color}
      />
    </svg>
  );
}