import type { ReactNode } from "react";

/**
 * Claymorphism × neo-brutalist surface for dashboard panels. The signature
 * look — 3px dark border + hard offset shadow + inset bottom for clay puff —
 * lives in the .clay-card class in globals.css. One consistent treatment
 * across KPI tiles, charts, and the table. `hover` adds the lift-up-left pop.
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
      className={`clay-card ${hover ? "clay-card-hover" : ""} ${className}`}
      style={rest.style}
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
          className="text-sm font-extrabold tracking-tight"
          style={{ color: "var(--text)" }}
        >
          {title}
        </h2>
        {subtitle && (
          <div className="mt-0.5 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            {subtitle}
          </div>
        )}
      </div>
      {action && (
        <div className="shrink-0 text-xs font-bold" style={{ color: "var(--text-muted)" }}>
          {action}
        </div>
      )}
    </div>
  );
}