"use client";

import type { CSSProperties } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { fmt } from "@/lib/playground/sim";
import type { PlaygroundEdge } from "@/lib/playground/types";
import { cn } from "@/lib/utils";
import { useSim } from "./SimContext";

/**
 * Dash speed and stroke width follow the edge's traffic on a log scale, so
 * 200 rps crawls and 1M rps races. Zero traffic draws a still, faint line.
 */
export function TrafficEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps<PlaygroundEdge>) {
  const sim = useSim();
  const stats = sim.edges[id];
  const rps = stats?.rps ?? 0;
  const targetStatus = sim.nodes[target]?.status;
  const sourceStatus = sim.nodes[source]?.status;
  const intensity = rps > 0 ? Math.min(1, Math.log10(rps + 1) / 7) : 0;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ "--dash-ms": `${Math.round(1500 - 1300 * intensity)}ms`, "--width": 1.25 + 2.25 * intensity } as CSSProperties}
        className={cn("pg-edge", rps > 0 && "is-live", targetStatus === "overloaded" && "is-choked", sourceStatus === "overloaded" && "is-shed")}
      />
      {rps > 0 && (
        <EdgeLabelRenderer>
          <div
            className="flow-edge-label pg-edge-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {fmt(rps)} rps
            {stats.connections > 0 && <span className="text-inkFaint"> · {fmt(stats.connections)} conn</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { traffic: TrafficEdge };
