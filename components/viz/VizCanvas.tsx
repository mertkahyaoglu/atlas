"use client";

import "@xyflow/react/dist/base.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
} from "@xyflow/react";
import type { VizFrame } from "@/lib/viz/types";
import { cn } from "@/lib/utils";
import { nodeTypes, TONE_VAR, type FlowVizNode } from "./VizNodes";

/** Room kept around the drawing on every side. */
const FIT_PADDING = 16;

interface VizCanvasProps {
  frame: VizFrame;
  width: number;
  height: number;
}

/**
 * Fits from the drawing's declared size rather than from measured nodes: the
 * node set changes every frame, and refitting on each one would make the
 * whole drawing jump as things appear. Never enlarges past 100%.
 */
function useFitView(contentWidth: number, contentHeight: number) {
  const { setViewport } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const [ready, setReady] = useState(false);

  const fit = useCallback(() => {
    if (!width || !height) return;
    const zoom = Math.min(
      (width - FIT_PADDING * 2) / contentWidth,
      (height - FIT_PADDING * 2) / contentHeight,
      1,
    );
    setViewport({ x: (width - contentWidth * zoom) / 2, y: (height - contentHeight * zoom) / 2, zoom });
  }, [width, height, contentWidth, contentHeight, setViewport]);

  useEffect(() => {
    if (!width || !height) return;
    fit();
    setReady(true);
  }, [width, height, fit]);

  return ready;
}

function Canvas({ frame, width, height }: VizCanvasProps) {
  const ready = useFitView(width, height);

  const nodes = useMemo<FlowVizNode[]>(
    () =>
      frame.nodes.map((node) => ({
        id: node.id,
        type: node.shape,
        position: { x: node.x, y: node.y },
        width: node.width ?? 140,
        height: node.height ?? 34,
        data: { node },
        // Markers and notes are annotations; they sit under the boxes they label.
        zIndex: node.shape === "chip" ? 2 : node.shape === "note" || node.shape === "marker" ? 0 : 1,
        draggable: false,
        selectable: false,
        focusable: false,
      })),
    [frame],
  );

  const edges = useMemo<Edge[]>(
    () =>
      (frame.edges ?? []).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: `s-${edge.sourceSide ?? "r"}`,
        targetHandle: `t-${edge.targetSide ?? "l"}`,
        type: "smoothstep",
        label: edge.label,
        className: cn("viz-edge", edge.state === "active" && "is-active", edge.state === "dimmed" && "is-dimmed"),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 13,
          height: 13,
          color: edge.state === "active" ? TONE_VAR.blue : "var(--flow-edge)",
        },
        focusable: false,
        selectable: false,
      })),
    [frame],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      className={cn("viz-canvas transition-opacity duration-200", ready ? "opacity-100" : "opacity-0")}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      panOnDrag={false}
      panOnScroll={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      preventScrolling={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--flow-dot)" bgColor="var(--flow-canvas)" />
    </ReactFlow>
  );
}

export default function VizCanvas(props: VizCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
