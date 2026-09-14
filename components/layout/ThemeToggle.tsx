"use client";

import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { useUiStore } from "@/store/useUiStore";

export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

  // Zustand owns the state; the DOM class is a side effect of it.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="flex h-8 w-8 items-center justify-center rounded border border-rule text-inkMuted transition-colors duration-fast hover:border-ruleStrong hover:text-ink"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
