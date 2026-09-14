"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, X } from "lucide-react";
import type { DocMeta } from "@/lib/types";
import { useUiStore } from "@/store/useUiStore";
import { cn } from "@/lib/utils";
import { SidebarLink } from "./SidebarLink";

interface SidebarProps {
  concepts: DocMeta[];
  designs: DocMeta[];
}

interface SectionProps {
  heading: string;
  note: string;
  accent: string;
  docs: DocMeta[];
  activeSlug: string;
  onNavigate: () => void;
}

function Section({ heading, note, accent, docs, activeSlug, onNavigate }: SectionProps) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2 px-3">
        <h2 className="text-small font-semibold text-ink">{heading}</h2>
        <span className="font-mono text-micro" style={{ color: accent }}>
          {docs.length}
        </span>
      </div>
      <p className="mb-3 px-3 text-tiny leading-snug text-inkFaint">{note}</p>
      <nav className="flex flex-col">
        {docs.map((doc) => (
          <SidebarLink
            key={doc.slug}
            doc={doc}
            active={doc.slug === activeSlug}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
    </div>
  );
}

export function Sidebar({ concepts, designs }: SidebarProps) {
  const pathname = usePathname();
  const open = useUiStore((s) => s.sidebarOpen);
  const setOpen = useUiStore((s) => s.setSidebarOpen);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  const activeSlug = pathname.startsWith("/docs/") ? pathname.slice("/docs/".length) : "";

  const close = () => setOpen(false);

  // The html class is what actually hides the sidebar; keep it in step with the store.
  useEffect(() => {
    document.documentElement.classList.toggle("sidebar-collapsed", collapsed);
  }, [collapsed]);

  // `[` toggles the desktop sidebar, unless the reader is typing somewhere.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "[" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      toggleCollapsed();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={close}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}

      <aside
        data-sidebar
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-sidebar flex-col border-r border-rule bg-surface transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-4">
          <Link
            href="/"
            onClick={close}
            className="font-mono text-small font-medium tracking-tight text-ink"
          >
            atlas<span className="text-inkFaint">/</span>
            <span className="text-[color:var(--concept)]">sysdesign</span>
          </Link>
          <button
            type="button"
            onClick={close}
            aria-label="Close navigation"
            className="text-inkMuted hover:text-ink lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
            title="Collapse sidebar  ["
            className="hidden h-8 w-8 items-center justify-center rounded text-inkFaint transition-colors duration-fast hover:bg-raised hover:text-ink lg:flex"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto py-6">
          <Section
            heading="Concepts"
            note="Read in order. Each builds on the last."
            accent="var(--concept)"
            docs={concepts}
            activeSlug={activeSlug}
            onNavigate={close}
          />
          <Section
            heading="Designs"
            note="Ranked by how often they come up."
            accent="var(--design)"
            docs={designs}
            activeSlug={activeSlug}
            onNavigate={close}
          />
        </div>
      </aside>
    </>
  );
}
