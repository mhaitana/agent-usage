import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Code Usage",
  description: "Token usage by session, day, model, and project.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla's
          cz-shortcut-listen attribute) inject attributes onto <body> before
          React hydrates, causing a benign mismatch warning. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}