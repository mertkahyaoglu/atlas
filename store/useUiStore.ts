"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light";

interface UiState {
  theme: Theme;
  sidebarOpen: boolean;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

/**
 * Only the theme is persisted. Sidebar visibility is per-session — restoring a
 * mobile drawer as "open" on a fresh load would cover the page.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      sidebarOpen: false,
      toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
      setTheme: (theme) => set({ theme }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    }),
    {
      name: "atlas-ui",
      partialize: (state) => ({ theme: state.theme }),
    },
  ),
);
