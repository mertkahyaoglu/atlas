"use client";

import type { Edge, EdgeProps } from "@xyflow/react";
import type { LaidOutRelation } from "@/lib/diagram/erd";
import type { Point } from "@/lib/diagram/layout";
import { cn } from "@/lib/utils";

export type RelationState = "idle" | "active" | "dimmed";
export type RelationEdgeData = { relation: LaidOutRelation; state: RelationState };
export type RelationEdge = Edge<RelationEdgeData, "relation">;

const CORNER = 6;

/** Straight runs joined by rounded corners, each no wider than half its shorter run. */
function roundedPath(points: Point[]): string {
  const [first, ...rest] = points;
  if (!first) return "";
  let d = `M${first.x},${first.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(CORNER, ab / 2, bc / 2);
    if (r <= 0) continue;
    const start = { x: b.x + ((a.x - b.x) / ab) * r, y: b.y + ((a.y - b.y) / ab) * r };
    const end = { x: b.x + ((c.x - b.x) / bc) * r, y: b.y + ((c.y - b.y) / bc) * r };
    d += `L${start.x},${start.y}Q${b.x},${b.y} ${end.x},${end.y}`;
  }
  const last = rest[rest.length - 1] ?? first;
  return `${d}L${last.x},${last.y}`;
}

/** A foreign key: a dot on the referencing row, an arrow into the referenced one. */
export function RelationEdgeView({ data, markerEnd }: EdgeProps<RelationEdge>) {
  if (!data) return null;
  const { relation, state } = data;
  const start = relation.points[0];

  return (
    <g className={cn("erd-edge", `is-${state}`)}>
      <path d={roundedPath(relation.points)} fill="none" markerEnd={markerEnd} />
      {start && <circle cx={start.x} cy={start.y} r={2.5} />}
    </g>
  );
}

export const erdEdgeTypes = { relation: RelationEdgeView };
