"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light";

interface UiState {
  theme: Theme;
  sidebarOpen: boolean;
  /** Desktop only: hide the sidebar for more reading room. */
  sidebarCollapsed: boolean;
  /** Sidebar sections the reader has folded away, by id. */
  collapsedSections: string[];
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleSidebarCollapsed: () => void;
  toggleSection: (id: string) => void;
  expandSection: (id: string) => void;
}

/**
 * Theme and both collapse preferences are persisted. The mobile drawer's open
 * state is per-session — restoring it as "open" on a fresh load would cover
 * the page.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      sidebarOpen: false,
      sidebarCollapsed: false,
      collapsedSections: [],
      toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
      setTheme: (theme) => set({ theme }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleSection: (id) =>
        set((s) => ({
          collapsedSections: s.collapsedSections.includes(id)
            ? s.collapsedSections.filter((section) => section !== id)
            : [...s.collapsedSections, id],
        })),
      expandSection: (id) => set((s) => ({ collapsedSections: s.collapsedSections.filter((section) => section !== id) })),
    }),
    {
      name: "atlas-ui",
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        collapsedSections: state.collapsedSections,
      }),
    },
  ),
);
