import { clsx, type ClassValue } from "clsx";
import type { DocGroup, DocMeta, Track } from "./types";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's default font sizes, so it reads the
 * custom scale (`text-micro`, `text-tiny`, …) as text colours and drops them
 * when a real colour class is also present. Registering the scale keeps both.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "tiny", "small", "base", "lead", "h3", "h2", "h1", "display"] }],
    },
  },
});

/** Merge conditional class names, with later Tailwind utilities winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Accent CSS variable for a group. Components read `--accent`, never a theme. */
export function accentVar(group: DocGroup) {
  return { "--accent": `var(--${group})` } as React.CSSProperties;
}

/** Where a document lives: the coding track has its own route, everything else is under /docs. */
export function docHref(doc: Pick<DocMeta, "group" | "slug">) {
  return doc.group === "coding" ? `/coding/${doc.slug}` : `/docs/${doc.slug}`;
}

/** Which half of the atlas a path belongs to — decides what the sidebar lists. */
export function trackOf(pathname: string): Track {
  return pathname === "/coding" || pathname.startsWith("/coding/") ? "coding" : "sysdesign";
}
