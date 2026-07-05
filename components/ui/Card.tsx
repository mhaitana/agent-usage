import type { ReactNode } from "react";

/**
 * Shared surface container for dashboard panels. One consistent elevation,
 * radius, and border treatment across KPI tiles, charts, and the table —
 * replaces the per-component Frame duplication. Use the optional `hover`
 * flag for interactive cards (KPI tiles, chart cards that expand on hover).
 */
export function Card({
  children,
  className = "",
  hover = false,
  as: Tag = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  as?: "div" | "section" | "article";
} & Omit<React.HTMLAttributes<HTMLElement>, "children" | "className">) {
  return (
    <Tag
      className={`rounded-xl border ${hover ? "transition-[box-shadow,border-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]" : ""} ${className}`}
      style={{
        background: "var(--surface-1)",
        borderColor: "var(--border-ring)",
        boxShadow: "var(--shadow-sm)",
        ...rest.style,
      }}
    >
      {children}
    </Tag>
  );
}

/**
 * Standard panel header: title, subtitle, and an optional right-aligned
 * action/metadata slot. Keeps every chart/table title visually identical.
 */
export function CardHeader({
  title,
  subtitle,
  action,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-4 flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2
          className="text-[13px] font-semibold tracking-tight"
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </h2>
        {subtitle && (
          <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            {subtitle}
          </div>
        )}
      </div>
      {action && <div className="shrink-0 text-xs">{action}</div>}
    </div>
  );
}