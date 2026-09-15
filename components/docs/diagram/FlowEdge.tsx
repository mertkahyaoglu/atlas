"use client";

import { EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import type { LaidOutEdge, Point } from "@/lib/diagram/layout";
import { cn } from "@/lib/utils";

export type EdgeState = "idle" | "active" | "dimmed";
export type DiagramEdgeData = { edge: LaidOutEdge; state: EdgeState };
export type DiagramEdge = Edge<DiagramEdgeData, "flow">;

/**
 * A B-spline through the layout's route points (d3's curveBasis), so edges
 * bend smoothly around nodes instead of cutting straight across them.
 */
export function basisPath(points: Point[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  let d = `M${first.x},${first.y}`;
  if (rest.length === 0) return d;
  if (rest.length === 1) return `${d}L${rest[0].x},${rest[0].y}`;

  let [x0, y0, x1, y1] = [first.x, first.y, rest[0].x, rest[0].y];
  d += `L${(5 * x0 + x1) / 6},${(5 * y0 + y1) / 6}`;
  const curve = (x: number, y: number) => {
    d += `C${(2 * x0 + x1) / 3},${(2 * y0 + y1) / 3} ${(x0 + 2 * x1) / 3},${(y0 + 2 * y1) / 3} ${(x0 + 4 * x1 + x) / 6},${(y0 + 4 * y1 + y) / 6}`;
    [x0, y0, x1, y1] = [x1, y1, x, y];
  };
  for (const p of rest.slice(1)) curve(p.x, p.y);
  curve(x1, y1);
  return `${d}L${x1},${y1}`;
}

export function FlowEdge({ data, markerEnd }: EdgeProps<DiagramEdge>) {
  if (!data) return null;
  const { edge, state } = data;

  return (
    <>
      <path
        d={basisPath(edge.points)}
        fill="none"
        markerEnd={markerEnd}
        className={cn("flow-edge", `flow-edge--${edge.line}`, `is-${state}`)}
      />
      {edge.label.length > 0 && edge.labelX !== undefined && (
        <EdgeLabelRenderer>
          <div
            className={cn("flow-edge-label", `is-${state}`)}
            style={{ transform: `translate(-50%, -50%) translate(${edge.labelX}px, ${edge.labelY}px)` }}
          >
            {edge.label.join("\n")}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { flow: FlowEdge };
