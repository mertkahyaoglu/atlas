import type { Config } from "tailwindcss";

/**
 * Design tokens live here and are exposed to CSS as `var(--*)` in globals.css.
 * Both themes map onto the same semantic names so components never branch on theme.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        raised: "var(--raised)",
        rule: "var(--rule)",
        ruleStrong: "var(--rule-strong)",
        ink: "var(--ink)",
        inkMuted: "var(--ink-muted)",
        inkFaint: "var(--ink-faint)",
        concept: "var(--concept)",
        design: "var(--design)",
        tech: "var(--tech)",
        coding: "var(--coding)",
        conceptSoft: "var(--concept-soft)",
        designSoft: "var(--design-soft)",
        techSoft: "var(--tech-soft)",
        codingSoft: "var(--coding-soft)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // A modular scale at ~1.25, set explicitly so headings stay disciplined.
        micro: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.02em" }],
        tiny: ["0.75rem", { lineHeight: "1.125rem" }],
        small: ["0.8125rem", { lineHeight: "1.375rem" }],
        base: ["0.9375rem", { lineHeight: "1.7" }],
        lead: ["1.0625rem", { lineHeight: "1.75" }],
        h3: ["1.125rem", { lineHeight: "1.4", letterSpacing: "-0.01em" }],
        h2: ["1.4375rem", { lineHeight: "1.3", letterSpacing: "-0.015em" }],
        h1: ["1.9375rem", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
        display: ["2.5rem", { lineHeight: "1.1", letterSpacing: "-0.03em" }],
      },
      maxWidth: {
        reading: "70ch",
        shell: "94rem",
      },
      spacing: {
        sidebar: "17rem",
        toc: "15rem",
      },
      borderRadius: {
        sm: "3px",
        DEFAULT: "4px",
        md: "6px",
      },
      transitionDuration: {
        fast: "120ms",
      },
    },
  },
  plugins: [],
};

export default config;
