"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import type { Track } from "@/lib/types";
import { cn } from "@/lib/utils";

const TRACKS: { id: Track; label: string; blurb: string; href: string; accent: string }[] = [
  {
    id: "sysdesign",
    label: "sysdesign",
    blurb: "Concepts, technologies and worked designs",
    href: "/",
    accent: "var(--concept)",
  },
  {
    id: "coding",
    label: "coding",
    blurb: "Data structures and algorithms, drawn step by step",
    href: "/coding",
    accent: "var(--coding)",
  },
];

/** The sidebar logo doubles as the switch between the two halves of the atlas. */
export function SiteSwitcher({ track, onNavigate }: { track: Track; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const current = TRACKS.find((item) => item.id === track)!;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Switch atlas"
        className="-ml-1.5 flex items-center gap-1 rounded px-1.5 py-1 font-mono text-small font-medium tracking-tight text-ink transition-colors duration-fast hover:bg-raised"
      >
        atlas<span className="text-inkFaint">/</span>
        <span style={{ color: current.accent }}>{current.label}</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 text-inkFaint transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Atlases"
          className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border border-ruleStrong bg-surface shadow-xl"
        >
          {TRACKS.map((item) => {
            const isCurrent = item.id === track;
            return (
              <Link
                key={item.id}
                href={item.href}
                role="menuitem"
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                }}
                style={{ "--item-accent": item.accent } as React.CSSProperties}
                className={cn(
                  "block border-b border-rule px-3 py-2.5 text-left transition-colors duration-fast last:border-b-0",
                  isCurrent
                    ? "bg-[color:color-mix(in_srgb,var(--item-accent)_10%,transparent)]"
                    : "hover:bg-raised",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-tiny text-inkFaint">atlas/</span>
                  <span className="font-mono text-small text-[color:var(--item-accent)]">{item.label}</span>
                  {isCurrent && (
                    <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-[color:var(--item-accent)]" aria-hidden />
                  )}
                </span>
                <span className="mt-0.5 block text-tiny leading-snug text-inkMuted">{item.blurb}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
