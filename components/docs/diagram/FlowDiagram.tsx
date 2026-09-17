"use client";

import { useMemo, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { FLAGS, KINDS, type NodeKind } from "@/lib/diagram/kinds";
import { layoutFlowchart, type DiagramLayout } from "@/lib/diagram/layout";
import { parseFlowchart } from "@/lib/diagram/parse";
import { cn } from "@/lib/utils";
import { DiagramError, DiagramFrame } from "./DiagramFrame";

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
  const result = useMemo<{ layout: DiagramLayout } | { error: string }>(() => {
    try {
      return { layout: layoutFlowchart(parseFlowchart(chart)) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Diagram failed to render" };
    }
  }, [chart]);

  if ("error" in result) return <DiagramError message={result.error} source={chart} />;

  const { layout } = result;
  const kinds = (Object.keys(KINDS) as NodeKind[]).filter(
    (kind) => KINDS[kind].inLegend && layout.nodes.some((node) => node.kind === kind),
  );
  const hasHot = layout.nodes.some((node) => node.hot);
  const hasScaled = layout.nodes.some((node) => node.scaled);

  const caption = (
    <>
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
    </>
  );

  return (
    <DiagramFrame width={layout.width} height={layout.height} caption={caption}>
      {({ expanded, toggleExpanded }) => (
        <FlowCanvas layout={layout} expanded={expanded} onToggleExpanded={toggleExpanded} />
      )}
    </DiagramFrame>
  );
}
