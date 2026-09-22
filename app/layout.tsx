import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeScript } from "@/components/layout/ThemeScript";
import "./globals.css";

const SITE_URL = "https://atlas-sysdes.vercel.app";
const DESCRIPTION =
  "Concept modules and worked system design problems, with architecture diagrams and trade-offs.";

export const metadata: Metadata = {
  // Resolves the relative URLs of the generated share cards. Without it, every
  // link posted anywhere renders as a bare box.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "System Design Atlas",
    template: "%s · System Design Atlas",
  },
  description: DESCRIPTION,
  applicationName: "System Design Atlas",
  authors: [{ name: "Mert Kahyaoğlu", url: "https://github.com/mertkahyaoglu" }],
  creator: "Mert Kahyaoğlu",
  keywords: [
    "system design",
    "system design interview",
    "distributed systems",
    "architecture diagrams",
    "scalability",
    "interview preparation",
  ],
  openGraph: {
    type: "website",
    siteName: "System Design Atlas",
    title: "System Design Atlas",
    description: DESCRIPTION,
    url: SITE_URL,
    locale: "en",
  },
  twitter: {
    card: "summary_large_image",
    title: "System Design Atlas",
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <AppShell>{children}</AppShell>
        <Analytics />
      </body>
    </html>
  );
}
