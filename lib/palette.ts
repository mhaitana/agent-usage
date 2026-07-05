// Categorical palette mirroring the CSS vars in globals.css.
// On-theme pastel chart palette (claymorphism × neo-brutalism). Category
// separation comes from the thick dark borders on segments/bars, not from
// saturated color — so pastels carry the theme without hurting legibility.
export const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
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