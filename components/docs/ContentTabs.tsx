"use client";

import { useId, useRef, useState } from "react";
import type { ContentTab } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";

/**
 * Tabs authored with `<!-- tab: … -->` markers (see `splitTabs`). Inactive
 * panels stay mounted but hidden, so each diagram renders once and switching
 * doesn't redraw it.
 */
export function ContentTabs({ tabs }: { tabs: ContentTab[] }) {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();

  function select(index: number) {
    const next = (index + tabs.length) % tabs.length;
    setActive(next);
    buttons.current[next]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const target =
      event.key === "ArrowRight" ? active + 1
      : event.key === "ArrowLeft" ? active - 1
      : event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
      : null;
    if (target === null) return;
    event.preventDefault();
    select(target);
  }

  return (
    <div>
      <div role="tablist" className="flex overflow-x-auto border-b border-rule">
        {tabs.map((tab, i) => {
          const [title, ...note] = tab.label.split(" · ");
          const selected = i === active;
          return (
            <button
              key={i}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${i}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${i}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={onKeyDown}
              className={cn(
                "-mb-px flex shrink-0 items-baseline gap-2 border-b-2 px-4 py-2.5 text-small transition-colors duration-fast",
                selected
                  ? "border-[color:var(--accent)] font-medium text-ink"
                  : "border-transparent text-inkMuted hover:text-ink",
              )}
            >
              {title}
              {note.length > 0 && <span className="font-mono text-micro text-inkFaint">{note.join(" · ")}</span>}
            </button>
          );
        })}
      </div>

      {tabs.map((tab, i) => (
        <div
          key={i}
          role="tabpanel"
          id={`${baseId}-panel-${i}`}
          aria-labelledby={`${baseId}-tab-${i}`}
          hidden={i !== active}
          // Panels aren't direct children of `.doc`, so restore its block spacing.
          className="[&>*+*]:mt-4"
        >
          <Markdown content={tab.content} />
        </div>
      ))}
    </div>
  );
}
