// Categorical palette mirroring the CSS vars in globals.css.
// Slots assigned in fixed order (the dataviz skill's CVD-safe order).
export const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
] as const;

export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}

/** Map a model id to a stable slot index (by sorted encounter order). */
export function buildColorMap(models: string[]): Map<string, string> {
  const sorted = [...models].sort();
  const map = new Map<string, string>();
  sorted.forEach((m, i) => map.set(m, seriesColor(i)));
  return map;
}