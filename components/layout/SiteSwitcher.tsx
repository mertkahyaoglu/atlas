"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The two atlases are separate apps on separate domains, so the switcher is a
 * menu of absolute links rather than routing. `current` is the one this app is.
 */
const SITES = [
  {
    id: "sysdesign",
    label: "sysdesign",
    name: "System Design Atlas",
    blurb: "Concepts, technologies and worked designs",
    href: "https://atlas-sysdes.vercel.app",
  },
  {
    id: "coding",
    label: "coding",
    name: "Coding Atlas",
    blurb: "Data structures and algorithms, drawn step by step",
    href: "https://atlas-coding-ten.vercel.app",
  },
] as const;

const CURRENT = "sysdesign";

export function SiteSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const current = SITES.find((site) => site.id === CURRENT)!;

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
        <span className="text-[color:var(--concept)]">{current.label}</span>
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
          {SITES.map((site) => {
            const isCurrent = site.id === CURRENT;
            const content = (
              <>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-tiny text-inkFaint">atlas/</span>
                  <span className="font-mono text-small text-ink">{site.label}</span>
                  {isCurrent && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-[color:var(--concept)]" aria-hidden />}
                </span>
                <span className="mt-0.5 block text-tiny leading-snug text-inkMuted">{site.blurb}</span>
              </>
            );
            const className = cn(
              "block border-b border-rule px-3 py-2.5 text-left transition-colors duration-fast last:border-b-0",
              isCurrent ? "bg-[color:var(--concept-soft)]" : "hover:bg-raised",
            );

            // The current atlas links home rather than off-site.
            return isCurrent ? (
              <Link
                key={site.id}
                href="/"
                role="menuitem"
                aria-current="true"
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                }}
                className={className}
              >
                {content}
              </Link>
            ) : (
              <a key={site.id} href={site.href} role="menuitem" className={className}>
                {content}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
