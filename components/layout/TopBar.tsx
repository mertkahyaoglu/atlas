"use client";

import Link from "next/link";
import { Menu, PanelLeftOpen } from "lucide-react";
import { useUiStore } from "@/store/useUiStore";
import { ThemeToggle } from "./ThemeToggle";

interface TopBarProps {
  /** Rendered beside the controls on document pages; blank on the home page. */
  crumb?: string;
}

export function TopBar({ crumb }: TopBarProps) {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleSidebarCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-rule bg-canvas/90 px-4 backdrop-blur sm:px-8">
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Open navigation"
        className="flex h-8 w-8 items-center justify-center rounded border border-rule text-inkMuted hover:text-ink lg:hidden"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Desktop: only shown once the sidebar is collapsed, as the way back. */}
      <button
        type="button"
        onClick={toggleSidebarCollapsed}
        aria-label="Expand sidebar"
        title="Expand sidebar  ["
        className="hidden h-8 w-8 items-center justify-center rounded border border-rule text-inkMuted transition-colors duration-fast hover:text-ink [.sidebar-collapsed_&]:lg:flex"
      >
        <PanelLeftOpen className="h-4 w-4" />
      </button>

      {crumb ? (
        <p className="min-w-0 flex-1 truncate text-small text-inkMuted">
          <Link href="/" className="hover:text-ink">
            Index
          </Link>
          <span className="px-2 text-inkFaint">/</span>
          <span className="text-ink">{crumb}</span>
        </p>
      ) : (
        <div className="flex-1" />
      )}

      <ThemeToggle />
    </header>
  );
}
