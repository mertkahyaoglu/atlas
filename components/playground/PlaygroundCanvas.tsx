"use client";

import "@xyflow/react/dist/base.css";
import { useCallback, useMemo, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { simulate } from "@/lib/playground/sim";
import type { ComponentKind } from "@/lib/playground/types";
import { usePlaygroundStore } from "@/store/usePlaygroundStore";
import { nodeTypes } from "./ComponentNode";
import { ConfigDialog } from "./ConfigDialog";
import { DRAG_TYPE, Palette } from "./Palette";
import { SimContext } from "./SimContext";
import { edgeTypes } from "./TrafficEdge";
import { WorkloadPanel } from "./WorkloadPanel";

function Inner() {
  const nodes = usePlaygroundStore((s) => s.nodes);
  const edges = usePlaygroundStore((s) => s.edges);
  const workload = usePlaygroundStore((s) => s.workload);
  const selectedId = usePlaygroundStore((s) => s.selectedId);
  const onNodesChange = usePlaygroundStore((s) => s.onNodesChange);
  const onEdgesChange = usePlaygroundStore((s) => s.onEdgesChange);
  const onConnect = usePlaygroundStore((s) => s.onConnect);
  const addNode = usePlaygroundStore((s) => s.addNode);
  const select = usePlaygroundStore((s) => s.select);
  const { screenToFlowPosition, getViewport } = useReactFlow();

  const result = useMemo(() => simulate(nodes, edges, workload), [nodes, edges, workload]);
  const selected = selectedId ? nodes.find((n) => n.id === selectedId) : undefined;

  const onDragOver = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      const kind = event.dataTransfer.getData(DRAG_TYPE) as ComponentKind;
      if (!kind) return;
      event.preventDefault();
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(kind, { x: position.x - 80, y: position.y - 20 });
    },
    [addNode, screenToFlowPosition],
  );

  /** Palette click: drop the new node near the centre of the current view. */
  const addAtCentre = useCallback(
    (kind: ComponentKind) => {
      const { x, y, zoom } = getViewport();
      const el = document.querySelector<HTMLElement>(".pg-canvas");
      const w = el?.clientWidth ?? 800;
      const h = el?.clientHeight ?? 600;
      const jitter = () => (Math.random() - 0.5) * 80;
      addNode(kind, { x: (w / 2 - x) / zoom + jitter(), y: (h / 2 - y) / zoom + jitter() });
    },
    [addNode, getViewport],
  );

  return (
    <SimContext.Provider value={result}>
      <div className="flex h-full min-h-0">
        <Palette onAdd={addAtCentre} />
        <div className="pg-canvas relative min-w-0 flex-1" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => select(node.id)}
            onPaneClick={() => select(null)}
            connectionLineType={ConnectionLineType.Bezier}
            defaultEdgeOptions={{ type: "traffic", markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } }}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.3}
            maxZoom={1.6}
            deleteKeyCode={["Backspace", "Delete"]}
            proOptions={{ hideAttribution: true }}
            className="flow-canvas"
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--flow-dot)" />
            <Controls showInteractive={false} className="pg-controls" />
          </ReactFlow>
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded border border-dashed border-ruleStrong px-4 py-3 text-small text-inkMuted">Drag components here to start building.</p>
            </div>
          )}
        </div>
        <WorkloadPanel result={result} />
      </div>
      {selected && <ConfigDialog key={selected.id} node={selected} stats={result.nodes[selected.id]} onClose={() => select(null)} />}
    </SimContext.Provider>
  );
}

export function PlaygroundCanvas() {
  return (
    <ReactFlowProvider>
      <Inner />
    </ReactFlowProvider>
  );
}
