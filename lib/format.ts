export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  return String(n);
}

export function formatFullTokens(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatCost(n: number): string {
  if (n < 0.01) return "$" + n.toFixed(4);
  if (n < 1) return "$" + n.toFixed(3);
  return "$" + n.toFixed(2);
}

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function humanizeProjectSlug(slug: string): string {
  // Slugs look like -Users-techtana-Projects-perkr
  const markers = ["-Projects-", "-project-", "-projects-"];
  for (const m of markers) {
    const idx = slug.indexOf(m);
    if (idx >= 0) {
      const tail = slug.slice(idx + m.length);
      return tail.replace(/-/g, "/").replace(/^\/+|\/+$/g, "") || slug;
    }
  }
  // Fallback: strip leading dashes.
  return slug.replace(/^-+/, "");
}