"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface VizCodeProps {
  source: string;
  language: string;
  /** 1-based lines the current frame is executing. */
  highlight: number[];
}

/**
 * The code beside the drawing, with the lines the current frame is running
 * marked. Kept in step with the player so the picture and the implementation
 * are read as one thing.
 */
export function VizCode({ source, language, highlight }: VizCodeProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const first = highlight[0];

  // Centre the running line without scrolling the page, which scrollIntoView would.
  useEffect(() => {
    const box = scroller.current;
    const line = first ? box?.querySelector<HTMLElement>(`[data-line="${first}"]`) : null;
    if (!box || !line) return;
    box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.clientHeight, behavior: "smooth" });
  }, [first]);

  const lines = source.split("\n");

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-rule bg-surface lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between border-b border-rule px-3 py-1.5">
        <span className="font-mono text-micro text-inkFaint">{language}</span>
        <span className="font-mono text-micro text-inkFaint">runs with the steps</span>
      </div>
      <div ref={scroller} className="max-h-56 flex-1 overflow-auto py-2 lg:max-h-[15.5rem]">
        <pre className="font-mono text-tiny leading-[1.55]">
          {lines.map((line, i) => {
            const number = i + 1;
            const on = highlight.includes(number);
            return (
              <div
                key={number}
                data-line={number}
                className={cn(
                  "flex gap-3 border-l-2 px-3 transition-colors duration-200",
                  on ? "border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] text-ink" : "border-transparent text-inkMuted",
                )}
              >
                <span className={cn("w-4 shrink-0 text-right tabular-nums", on ? "text-[color:var(--accent)]" : "text-inkFaint")}>
                  {number}
                </span>
                <code className="whitespace-pre">{line || " "}</code>
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}
