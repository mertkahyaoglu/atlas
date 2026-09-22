"use client";

import { Handle, Position, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import type { VizNode, VizSide, VizTone } from "@/lib/viz/types";
import { cn } from "@/lib/utils";

export const TONE_VAR: Record<VizTone, string> = {
  neutral: "var(--ink-faint)",
  blue: "var(--tone-blue)",
  green: "var(--tone-green)",
  amber: "var(--tone-amber)",
  red: "var(--tone-red)",
  violet: "var(--tone-violet)",
  teal: "var(--tone-teal)",
  pink: "var(--tone-pink)",
};

export type FlowVizNode = Node<{ node: VizNode }, VizNode["shape"]>;

const SIDES: [VizSide, Position][] = [
  ["l", Position.Left],
  ["r", Position.Right],
  ["t", Position.Top],
  ["b", Position.Bottom],
];

/** Every node exposes all four sides; an edge picks which two it uses. */
function Handles() {
  return (
    <>
      {SIDES.map(([side, position]) => (
        <span key={side}>
          <Handle className="viz-handle" type="target" id={`t-${side}`} position={position} isConnectable={false} />
          <Handle className="viz-handle" type="source" id={`s-${side}`} position={position} isConnectable={false} />
        </span>
      ))}
    </>
  );
}

function Shape({ data }: NodeProps<FlowVizNode>) {
  const { shape, title, detail, index, tone = "neutral", state } = data.node;

  if (shape === "note") {
    return (
      <div className="viz-node viz-node--note" style={{ ["--tone" as string]: TONE_VAR[tone] }}>
        {title}
        <Handles />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "viz-node",
        `viz-node--${shape}`,
        shape === "slot" && detail !== undefined && "is-filled",
        state === "active" && "is-active",
        state === "dimmed" && "is-dimmed",
        state === "pulsing" && "is-pulsing",
      )}
      style={{ ["--tone" as string]: TONE_VAR[tone] }}
    >
      {index !== undefined && <span className="viz-node__index">{index}</span>}
      <span className="viz-node__title">{title}</span>
      {detail !== undefined && <span className="viz-node__detail">{detail}</span>}
      <Handles />
    </div>
  );
}

export const nodeTypes: NodeTypes = {
  box: Shape,
  cell: Shape,
  slot: Shape,
  chip: Shape,
  op: Shape,
  note: Shape,
  marker: Shape,
};
