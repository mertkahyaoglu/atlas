"use client";

import { useEffect, useState } from "react";
import type { TocEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Highlights whichever heading is nearest the top of the viewport. */
function useActiveHeading(entries: TocEntry[]) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    if (entries.length === 0) return;

    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((r) => r.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      // Band across the upper third: a heading is "current" once it reaches it.
      { rootMargin: "-80px 0px -66% 0px", threshold: 0 },
    );

    for (const entry of entries) {
      const el = document.getElementById(entry.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [entries]);

  return activeId;
}

export function Toc({ entries }: { entries: TocEntry[] }) {
  const activeId = useActiveHeading(entries);
  if (entries.length < 3) return null;

  return (
    <nav aria-label="On this page" className="max-h-[calc(100vh-14rem)] overflow-y-auto">
      <p className="mb-3 text-tiny font-semibold text-ink">On this page</p>
      <ul className="space-y-1 border-l border-rule">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className={cn(
                "-ml-px block border-l py-1 text-tiny leading-snug transition-colors duration-fast",
                entry.depth === 3 ? "pl-6" : "pl-3",
                entry.id === activeId
                  ? "border-[color:var(--accent)] text-ink"
                  : "border-transparent text-inkMuted hover:text-ink",
              )}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
