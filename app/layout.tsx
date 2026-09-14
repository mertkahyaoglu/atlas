import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeScript } from "@/components/layout/ThemeScript";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "System Design Atlas",
    template: "%s · System Design Atlas",
  },
  description:
    "Concept modules and worked system design problems, with architecture diagrams and trade-offs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
