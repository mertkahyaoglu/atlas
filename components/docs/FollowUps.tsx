"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { DesignFollowUp } from "@/lib/types";
import { cn } from "@/lib/utils";
import { InlineMarkdown } from "./InlineMarkdown";

/**
 * Follow-up questions start collapsed so they work as self-test prompts:
 * read the question, answer it in your head, then reveal. Answers stay in the
 * DOM (hidden, not unmounted) so find-in-page still reaches them.
 */
export function FollowUps({ items }: { items: DesignFollowUp[] }) {
  const baseId = useId();
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const allOpen = open.size === items.length;

  function toggle(index: number) {
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="my-6 overflow-hidden rounded-md border border-rule bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule bg-canvas px-5 py-2.5">
        <span className="text-tiny text-inkFaint">
          <span className="font-mono uppercase tracking-wide text-inkMuted">{items.length} questions</span>
          <span className="px-2">·</span>
          try answering before you reveal
        </span>
        <button
          type="button"
          onClick={() => setOpen(allOpen ? new Set() : new Set(items.map((_, i) => i)))}
          className="shrink-0 rounded border border-rule px-2.5 py-1 text-tiny text-inkMuted transition-colors duration-fast hover:border-ruleStrong hover:text-ink"
        >
          {allOpen ? "Hide all answers" : "Reveal all answers"}
        </button>
      </div>

      <div className="divide-y divide-rule">
        {items.map((item, i) => {
          const isOpen = open.has(i);
          const panelId = `${baseId}-answer-${i}`;

          return (
            <div key={i}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(i)}
                className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors duration-fast hover:bg-raised"
              >
                <span className="mt-[3px] w-6 shrink-0 font-mono text-micro tabular-nums text-[color:var(--accent)]">
                  Q{i + 1}
                </span>
                <span className="min-w-0 flex-1 text-small font-medium leading-relaxed text-ink">
                  <InlineMarkdown>{item.question}</InlineMarkdown>
                </span>
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "mt-1 h-4 w-4 shrink-0 text-inkFaint transition-transform duration-fast",
                    isOpen && "rotate-180",
                  )}
                />
              </button>
              <div id={panelId} hidden={!isOpen} className="pb-4 pl-14 pr-5">
                <div className="border-l-2 border-[color:var(--accent)] pl-3 text-small leading-relaxed text-inkMuted">
                  <InlineMarkdown>{item.answer}</InlineMarkdown>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
