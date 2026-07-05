import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Code Usage",
  description: "Token usage by session, day, model, and project.",
};

/**
 * No-FOUC theme boot. Runs before paint: reads the saved preference
 * (system | light | dark; default system), resolves "system" to light/dark
 * via matchMedia, and sets <html data-theme="light"|"dark">. CSS only has
 * light (default :root) and [data-theme="dark"] — no media query — so the
 * boot script is the single resolver for system mode. Inline + blocking so
 * the correct palette applies on the very first frame (no FOUC). Kept in
 * sync with the ThemeSwitcher, which writes the same localStorage key.
 */
const themeBoot = `
(function () {
  function resolve(t) {
    if (t === "light" || t === "dark") return t;
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (e) { return "light"; }
  }
  try {
    var t = localStorage.getItem("theme");
    document.documentElement.setAttribute("data-theme", resolve(t));
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      {/* suppressHydrationWarning: the boot script mutates data-theme before
          React hydrates, and browser extensions inject body attributes — both
          are benign mismatches we intentionally suppress. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}