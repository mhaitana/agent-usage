"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Sun, Moon, Monitor } from "@/components/ui/icons";

export type Theme = "system" | "light" | "dark";

const ORDER: Theme[] = ["system", "light", "dark"];
const LABELS: Record<Theme, string> = {
  system: "System theme",
  light: "Light theme",
  dark: "Dark theme",
};

/*
  External theme store. The logical preference (system | light | dark) is
  kept in localStorage; the APPLIED data-theme attribute is always "light"
  or "dark" (CSS only knows those two). "system" is resolved via matchMedia
  both here and in the layout.tsx boot script (no-FOUC). useSyncExternalStore
  reads this external store during render without setState-in-effect.
*/
let currentTheme: Theme = "system";
const listeners = new Set<() => void>();

function resolveTheme(t: Theme): "light" | "dark" {
  if (t === "light" || t === "dark") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("theme");
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {
    /* localStorage unavailable — default to system. */
  }
  return "system";
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", resolveTheme(t));
}

function writeTheme(t: Theme) {
  currentTheme = t;
  applyTheme(t);
  try {
    localStorage.setItem("theme", t);
  } catch {
    /* private mode — in-memory only. */
  }
  listeners.forEach((l) => l());
}

// On client load, sync the in-memory value with the boot script's resolution.
if (typeof window !== "undefined") {
  currentTheme = readTheme();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // In System mode, re-resolve and apply when the OS appearance changes.
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onOs = () => {
    if (currentTheme === "system") {
      applyTheme("system");
      listeners.forEach((l) => l());
    }
  };
  mq.addEventListener("change", onOs);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", onOs);
  };
}

function getSnapshot(): Theme {
  return currentTheme;
}

function getServerSnapshot(): Theme {
  return "system";
}

/**
 * Three-way theme switcher (System / Light / Dark). Persists the logical
 * preference to localStorage; the applied <html data-theme> is always
 * light/dark, resolved from "system" via matchMedia. The boot script reads
 * the same key pre-paint to avoid FOUC.
 */
export default function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const choose = useCallback((t: Theme) => writeTheme(t), []);

  return (
    <div
      className="clay-chip inline-flex items-center gap-1 p-1"
      style={{ background: "var(--bg)" }}
      role="group"
      aria-label="Color theme"
    >
      {ORDER.map((t) => {
        const Icon = t === "light" ? Sun : t === "dark" ? Moon : Monitor;
        const active = theme === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => choose(t)}
            aria-label={LABELS[t]}
            aria-pressed={active}
            title={LABELS[t]}
            className="inline-flex h-7 w-7 items-center justify-center transition-colors duration-150"
            style={{
              borderRadius: "var(--radius-chip)",
              background: active ? "var(--accent-purple)" : "transparent",
              color: active ? "var(--ink)" : "var(--text-muted)",
              boxShadow: active ? "none" : "none",
              fontSize: "0.95em",
            }}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}