"use client";

import "@xyflow/react/dist/base.css";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type Node,
} from "@xyflow/react";
import type { DiagramLayout } from "@/lib/diagram/layout";
import { cn } from "@/lib/utils";
import { CanvasToolbar, useCoarsePointer, useFitView } from "./CanvasToolbar";
import { DiagramContext, type DiagramActions } from "./DiagramContext";
import { nodeHandles, nodeTypes, type ClusterNode, type DiagramNode } from "./DiagramNodes";
import { edgeTypes, type DiagramEdge, type EdgeState } from "./FlowEdge";
import { NodeDetailDialog } from "./NodeDetailDialog";

interface FlowCanvasProps {
  layout: DiagramLayout;
  expanded: boolean;
  onToggleExpanded: () => void;
}

function Canvas({ layout, expanded, onToggleExpanded }: FlowCanvasProps) {
  const coarse = useCoarsePointer();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { fit, ready } = useFitView(layout.width, layout.height);

  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const focusId = selected ?? hovered;

  const neighbours = useMemo(() => {
    if (!focusId) return null;
    const ids = new Set([focusId]);
    for (const edge of layout.edges) {
      if (edge.source === focusId) ids.add(edge.target);
      if (edge.target === focusId) ids.add(edge.source);
    }
    return ids;
  }, [focusId, layout]);

  // Stacking: groups sit behind edges (-1), edges and their labels in the
  // middle, nodes on top (1).
  const nodes = useMemo<Node[]>(() => {
    const clusters: ClusterNode[] = layout.groups.map((group) => ({
      id: `group:${group.id}`,
      type: "cluster",
      position: { x: group.x, y: group.y },
      width: group.width,
      height: group.height,
      data: { title: group.title },
      zIndex: -1,
      selectable: false,
      focusable: false,
    }));
    const boxes: DiagramNode[] = layout.nodes.map((node) => ({
      id: node.id,
      type: node.kind,
      position: { x: node.x, y: node.y },
      width: node.width,
      height: node.height,
      handles: nodeHandles(layout.direction, node.width, node.height),
      data: { node, dimmed: neighbours ? !neighbours.has(node.id) : false, active: node.id === focusId },
      zIndex: 1,
    }));
    return [...clusters, ...boxes];
  }, [layout, neighbours, focusId]);

  const edges = useMemo<DiagramEdge[]>(
    () =>
      layout.edges
        .filter((edge) => edge.line !== "invisible")
        .map((edge) => {
          const state: EdgeState = !focusId
            ? "idle"
            : edge.source === focusId || edge.target === focusId
              ? "active"
              : "dimmed";
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            type: "flow",
            data: { edge, state },
            markerEnd: edge.arrow
              ? {
                  type: MarkerType.ArrowClosed,
                  width: 14,
                  height: 14,
                  color: state === "active" ? "var(--flow-edge-active)" : "var(--flow-edge)",
                }
              : undefined,
          };
        }),
    [layout, focusId],
  );

  const actions = useMemo<DiagramActions>(
    () => ({ direction: layout.direction, openNode: setSelected, hoverNode: setHovered }),
    [layout.direction],
  );

  const closeDialog = useCallback(() => {
    const id = selected;
    setSelected(null);
    // Return focus to the node that is now showing, like a native dialog would.
    requestAnimationFrame(() => {
      wrapperRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"] button`)?.focus();
    });
  }, [selected]);

  const selectedNode = selected ? layout.nodes.find((node) => node.id === selected) : undefined;

  return (
    <div ref={wrapperRef} className="relative h-full w-full">
      <DiagramContext.Provider value={actions}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          className={cn("flow-canvas transition-opacity duration-200", ready ? "opacity-100" : "opacity-0")}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          // Node handlers also tell React Flow the nodes are interactive; without
          // any, it turns off pointer events on them and the node buttons go dead.
          onNodeMouseEnter={(_, node) => node.type !== "cluster" && setHovered(node.id)}
          onNodeMouseLeave={() => setHovered(null)}
          // Inline, the wheel scrolls the page; ⌘/Ctrl + wheel or a pinch zooms.
          // Expanded, the diagram owns the wheel.
          zoomOnScroll={expanded}
          preventScrolling={expanded}
          zoomOnPinch
          zoomOnDoubleClick={false}
          panOnDrag={expanded || !coarse}
          minZoom={0.1}
          maxZoom={2.5}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--flow-dot)" bgColor="var(--flow-canvas)" />
        </ReactFlow>
      </DiagramContext.Provider>

      <CanvasToolbar expanded={expanded} onToggleExpanded={onToggleExpanded} onFit={() => fit(200)} />

      {selectedNode && (
        <NodeDetailDialog node={selectedNode} layout={layout} onSelect={setSelected} onClose={closeDialog} />
      )}
    </div>
  );
}

export default function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
