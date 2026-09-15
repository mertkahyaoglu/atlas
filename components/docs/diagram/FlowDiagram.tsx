"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { FLAGS, KINDS, type NodeKind } from "@/lib/diagram/kinds";
import { layoutFlowchart } from "@/lib/diagram/layout";
import { parseFlowchart } from "@/lib/diagram/parse";
import { cn } from "@/lib/utils";

// React Flow only runs in the browser, and loading it lazily keeps it out of
// the page's first bundle. The frame around it renders on the server at its
// final height, so nothing shifts when it arrives.
const FlowCanvas = dynamic(() => import("./FlowCanvas"), { ssr: false });

function LegendSwatch({ tone, className }: { tone: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("h-2.5 w-2.5 rounded-[3px] border", className)}
      style={{ "--tone": tone, borderColor: tone, background: `color-mix(in srgb, ${tone} 25%, transparent)` } as CSSProperties}
    />
  );
}

export function FlowDiagram({ chart }: { chart: string }) {
  const [expanded, setExpanded] = useState(false);

  const result = useMemo(() => {
    try {
      return { layout: layoutFlowchart(parseFlowchart(chart)) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Diagram failed to render" };
    }
  }, [chart]);

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

  if ("error" in result) {
    return (
      <div className="my-6 rounded border border-rule bg-surface p-4">
        <p className="mb-2 text-tiny text-inkMuted">This diagram could not be drawn ({result.error}). The source is below.</p>
        <pre className="overflow-x-auto font-mono text-tiny text-inkFaint">{chart}</pre>
      </div>
    );
  }

  const { layout } = result;
  const kinds = (Object.keys(KINDS) as NodeKind[]).filter(
    (kind) => KINDS[kind].inLegend && layout.nodes.some((node) => node.kind === kind),
  );
  const hasHot = layout.nodes.some((node) => node.hot);
  const hasScaled = layout.nodes.some((node) => node.scaled);

  // Natural size when the column is wide enough, otherwise scaled down to fit
  // the column's width. Capping the height instead would shrink tall diagrams
  // past legible; the wheel scrolls the page past them, so height is cheap.
  const ratio = (layout.height / layout.width).toFixed(4);
  const frameHeight = `clamp(220px, min(${layout.height}px, ${ratio} * 100cqw), 1400px)`;

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
          <FlowCanvas layout={layout} expanded={expanded} onToggleExpanded={() => setExpanded((value) => !value)} />
        </div>
      </div>

      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-rule bg-surface px-4 py-2.5">
        {kinds.map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1.5 font-mono text-micro text-inkMuted">
            <LegendSwatch tone={KINDS[kind].tone} />
            {KINDS[kind].label}
          </span>
        ))}
        {hasHot && (
          <span className="inline-flex items-center gap-1.5 font-mono text-micro text-inkMuted" title={FLAGS.hot.description}>
            <LegendSwatch tone="var(--tone-amber)" className="border-2" />
            {FLAGS.hot.label}
          </span>
        )}
        {hasScaled && (
          <span className="inline-flex items-center gap-1.5 font-mono text-micro text-inkMuted" title={FLAGS.scaled.description}>
            <LegendSwatch tone="var(--ink-faint)" className="border-dashed" />
            {FLAGS.scaled.label}
          </span>
        )}
        <span className="ml-auto text-micro text-inkFaint">
          Click a node for details<span className="hidden sm:inline"> · ⌘/Ctrl + scroll to zoom</span>
        </span>
      </figcaption>
    </figure>
  );
}
