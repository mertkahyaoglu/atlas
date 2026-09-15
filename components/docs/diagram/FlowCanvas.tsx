"use client";

import "@xyflow/react/dist/base.css";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Node,
} from "@xyflow/react";
import { Maximize2, Minimize2, Scan, ZoomIn, ZoomOut } from "lucide-react";
import type { DiagramLayout } from "@/lib/diagram/layout";
import { cn } from "@/lib/utils";
import { DiagramContext, type DiagramActions } from "./DiagramContext";
import { nodeHandles, nodeTypes, type ClusterNode, type DiagramNode } from "./DiagramNodes";
import { edgeTypes, type DiagramEdge, type EdgeState } from "./FlowEdge";
import { NodeDetailDialog } from "./NodeDetailDialog";

interface FlowCanvasProps {
  layout: DiagramLayout;
  expanded: boolean;
  onToggleExpanded: () => void;
}

const FIT_PADDING = 12;

function subscribeCoarse(onChange: () => void) {
  const query = window.matchMedia("(pointer: coarse)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Touch screens: dragging the inline diagram would trap the page's scroll. */
function useCoarsePointer() {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

function ToolbarButton({ label, onClick, disabled, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded-sm text-inkMuted transition-colors duration-fast hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Canvas({ layout, expanded, onToggleExpanded }: FlowCanvasProps) {
  const coarse = useCoarsePointer();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { setViewport, zoomIn, zoomOut } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const zoom = useStore((s) => s.transform[2]);
  const minZoom = useStore((s) => s.minZoom);
  const maxZoom = useStore((s) => s.maxZoom);

  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  /**
   * Fit from the known layout size rather than measured nodes: a diagram in a
   * hidden tab has nothing to measure, and this also refits when the pane is
   * resized, shown, or expanded. Never enlarges past 100%.
   */
  const fit = useCallback(
    (duration = 0) => {
      if (!width || !height) return;
      const z = Math.min((width - FIT_PADDING * 2) / layout.width, (height - FIT_PADDING * 2) / layout.height, 1);
      setViewport({ x: (width - layout.width * z) / 2, y: (height - layout.height * z) / 2, zoom: z }, { duration });
    },
    [width, height, layout, setViewport],
  );

  useEffect(() => {
    if (!width || !height) return;
    fit();
    setReady(true);
  }, [width, height, fit]);

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

      <div
        role="toolbar"
        aria-label="Diagram view"
        className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded border border-rule bg-surface/90 p-0.5 shadow-sm backdrop-blur"
      >
        <ToolbarButton label="Zoom out" onClick={() => zoomOut({ duration: 150 })} disabled={zoom <= minZoom}>
          <ZoomOut className="h-3.5 w-3.5" aria-hidden />
        </ToolbarButton>
        <span aria-live="polite" className="min-w-[2.75rem] text-center font-mono text-micro tabular-nums text-inkMuted">
          {Math.round(zoom * 100)}%
        </span>
        <ToolbarButton label="Zoom in" onClick={() => zoomIn({ duration: 150 })} disabled={zoom >= maxZoom}>
          <ZoomIn className="h-3.5 w-3.5" aria-hidden />
        </ToolbarButton>
        <ToolbarButton label="Fit to view" onClick={() => fit(200)}>
          <Scan className="h-3.5 w-3.5" aria-hidden />
        </ToolbarButton>
        <span className="mx-0.5 h-4 w-px bg-rule" aria-hidden />
        <ToolbarButton label={expanded ? "Exit full screen" : "Full screen"} onClick={onToggleExpanded}>
          {expanded ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
        </ToolbarButton>
      </div>

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
