"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Room the canvas keeps around a fitted drawing, on every side. */
export const FIT_PADDING = 12;

interface DiagramFrameProps {
  /** The drawing's natural size, which sizes the inline frame. */
  width: number;
  height: number;
  caption: React.ReactNode;
  children: (view: { expanded: boolean; toggleExpanded: () => void }) => React.ReactNode;
}

/**
 * The figure around a React Flow canvas: sized to its drawing inline, able to
 * expand to full screen, with a caption strip underneath.
 */
export function DiagramFrame({ width, height, caption, children }: DiagramFrameProps) {
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape inside the node dialog closes the dialog, not full screen.
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) setExpanded(false);
    };
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      root.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  // Natural size when the column is wide enough, otherwise scaled down to fit
  // the column's width. Capping the height instead would shrink tall diagrams
  // past legible; the wheel scrolls the page past them, so height is cheap.
  // Both terms leave room for the fit padding, so a drawing that fits is 100%.
  const pad = FIT_PADDING * 2;
  const ratio = (height / width).toFixed(4);
  const frameHeight = `clamp(220px, min(${height + pad}px, ${ratio} * 100cqw + ${pad}px), 1400px)`;

  return (
    <figure className="flow-figure my-8 overflow-hidden rounded-md border border-rule [container-type:inline-size]">
      <div className="relative" style={{ height: frameHeight }}>
        {expanded && (
          <div aria-hidden className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setExpanded(false)} />
        )}
        <div
          role={expanded ? "dialog" : undefined}
          aria-modal={expanded || undefined}
          aria-label={expanded ? "Diagram, full screen" : undefined}
          className={cn(
            "flow-frame",
            expanded
              ? "fixed inset-3 z-50 overflow-hidden rounded-md border border-ruleStrong shadow-2xl sm:inset-8"
              : "absolute inset-0",
          )}
        >
          {children({ expanded, toggleExpanded })}
        </div>
      </div>

      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-rule bg-surface px-4 py-2.5">
        {caption}
      </figcaption>
    </figure>
  );
}

/** Shown in place of a diagram whose source couldn't be drawn. */
export function DiagramError({ message, source }: { message: string; source: string }) {
  return (
    <div className="my-6 rounded border border-rule bg-surface p-4">
      <p className="mb-2 text-tiny text-inkMuted">This diagram could not be drawn ({message}). The source is below.</p>
      <pre className="overflow-x-auto font-mono text-tiny text-inkFaint">{source}</pre>
    </div>
  );
}
