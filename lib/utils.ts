import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, with later Tailwind utilities winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Accent CSS variable for a group. Components read `--accent`, never a theme. */
export function accentVar(group: "concept" | "design") {
  return { "--accent": `var(--${group})` } as React.CSSProperties;
}
