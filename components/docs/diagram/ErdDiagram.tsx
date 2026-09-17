"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { layoutErd, parseErd, type ErdLayout } from "@/lib/diagram/erd";
import { DiagramError, DiagramFrame } from "./DiagramFrame";

// Loaded lazily for the same reasons as the flowchart canvas.
const ErdCanvas = dynamic(() => import("./ErdCanvas"), { ssr: false });

/** A ```erd fence: tables as React Flow nodes, foreign keys as connectors between rows. */
export function ErdDiagram({ source }: { source: string }) {
  const result = useMemo<{ layout: ErdLayout } | { error: string }>(() => {
    try {
      return { layout: layoutErd(parseErd(source)) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Diagram failed to render" };
    }
  }, [source]);

  if ("error" in result) return <DiagramError message={result.error} source={source} />;

  const { layout } = result;
  const columns = layout.tables.flatMap((table) => table.columns);
  const hasSortKey = columns.some((column) => column.sk);

  // Only the markings this diagram uses.
  const legend = [
    columns.some((column) => column.pk) && {
      swatch: <span className="erd-badge erd-badge--pk">PK</span>,
      label: hasSortKey ? "primary or partition key" : "primary key",
    },
    hasSortKey && {
      swatch: <span className="erd-badge erd-badge--sk">SK</span>,
      label: columns.some((column) => column.desc) ? "sort key, ↓ newest first" : "sort key",
    },
    columns.some((column) => column.ref) && {
      swatch: <span className="erd-badge erd-badge--fk">FK</span>,
      label: "foreign key → referenced column",
    },
    columns.some((column) => column.nullable) && {
      swatch: <span className="text-inkFaint">type?</span>,
      label: "nullable",
    },
  ].filter((item) => item !== false);

  const caption = (
    <>
      {legend.map(({ swatch, label }) => (
        <span key={label} className="inline-flex items-center gap-1.5 font-mono text-micro text-inkMuted">
          <span aria-hidden className="contents">
            {swatch}
          </span>
          {label}
        </span>
      ))}
      <span className="ml-auto text-micro text-inkFaint">
        {layout.relations.length > 0 && "Hover a table or column to trace its keys"}
        <span className="hidden sm:inline">
          {layout.relations.length > 0 && " · "}⌘/Ctrl + scroll to zoom
        </span>
      </span>
    </>
  );

  return (
    <DiagramFrame width={layout.width} height={layout.height} caption={caption}>
      {({ expanded, toggleExpanded }) => (
        <ErdCanvas layout={layout} expanded={expanded} onToggleExpanded={toggleExpanded} />
      )}
    </DiagramFrame>
  );
}
