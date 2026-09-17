"use client";

import "@xyflow/react/dist/base.css";
import { useCallback, useMemo, useState } from "react";
import { Background, BackgroundVariant, MarkerType, ReactFlow, ReactFlowProvider, type Node } from "@xyflow/react";
import type { ErdLayout, LaidOutRelation } from "@/lib/diagram/erd";
import { cn } from "@/lib/utils";
import { CanvasToolbar, useCoarsePointer, useFitView } from "./CanvasToolbar";
import { ClusterNodeView, type ClusterNode } from "./DiagramNodes";
import { erdEdgeTypes, type RelationEdge, type RelationState } from "./ErdEdge";
import { ErdContext, TableNodeView, tableHandles, type TableNode, type TableState } from "./ErdNodes";

interface ErdCanvasProps {
  layout: ErdLayout;
  expanded: boolean;
  onToggleExpanded: () => void;
}

type Focus = { table: string; column?: string } | null;

const nodeTypes = { table: TableNodeView, cluster: ClusterNodeView };

function Canvas({ layout, expanded, onToggleExpanded }: ErdCanvasProps) {
  const coarse = useCoarsePointer();
  const { fit, ready } = useFitView(layout.width, layout.height);
  const [focus, setFocus] = useState<Focus>(null);
  const focusColumn = useCallback((table: string, column?: string) => setFocus({ table, column }), []);

  // The keys on the focused column, or on the whole table when that column has none.
  const highlight = useMemo(() => {
    // Without keys there is nothing to trace, so hovering changes nothing.
    if (!focus || !layout.relations.length) return null;
    const touches = (relation: LaidOutRelation, column?: string) =>
      (relation.source === focus.table && (column === undefined || relation.sourceColumn === column)) ||
      (relation.target === focus.table && (column === undefined || relation.targetColumn === column));

    let active = focus.column ? layout.relations.filter((relation) => touches(relation, focus.column)) : [];
    if (!active.length) active = layout.relations.filter((relation) => touches(relation));

    const tables = new Set([focus.table]);
    const columns = new Set<string>();
    for (const relation of active) {
      tables.add(relation.source).add(relation.target);
      columns.add(`${relation.source}.${relation.sourceColumn}`);
      if (relation.targetColumn) columns.add(`${relation.target}.${relation.targetColumn}`);
    }
    return { relations: new Set(active.map((relation) => relation.id)), tables, columns };
  }, [focus, layout]);

  // Stacking: groups sit behind connectors (-1), tables on top (1).
  const nodes = useMemo<Node[]>(() => {
    const clusters: ClusterNode[] = layout.groups.map((group) => ({
      id: `group:${group.id}`,
      type: "cluster",
      position: { x: group.x, y: group.y },
      width: group.width,
      height: group.height,
      data: { title: group.title, inset: group.inset },
      zIndex: -1,
      selectable: false,
      focusable: false,
    }));
    const tables: TableNode[] = layout.tables.map((table) => {
      const state: TableState = !highlight
        ? "idle"
        : table.name === focus?.table
          ? "active"
          : highlight.tables.has(table.name)
            ? "idle"
            : "dimmed";
      const linked = new Set(
        table.columns.filter((column) => highlight?.columns.has(`${table.name}.${column.name}`)).map((column) => column.name),
      );
      return {
        id: table.name,
        type: "table",
        position: { x: table.x, y: table.y },
        width: table.width,
        height: table.height,
        handles: tableHandles(table),
        data: { table, state, linked },
        zIndex: 1,
      };
    });
    return [...clusters, ...tables];
  }, [layout, highlight, focus]);

  // Highlighted connectors come last, so they paint over the idle ones they share a lane with.
  const edges = useMemo<RelationEdge[]>(() => {
    const withState = layout.relations.map((relation) => {
      const state: RelationState = !highlight ? "idle" : highlight.relations.has(relation.id) ? "active" : "dimmed";
      return { relation, state };
    });
    return withState
      .sort((a, b) => Number(a.state === "active") - Number(b.state === "active"))
      .map(({ relation, state }) => ({
        id: relation.id,
        source: relation.source,
        target: relation.target,
        type: "relation",
        data: { relation, state },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 12,
          height: 12,
          color: state === "active" ? "var(--flow-edge-active)" : "var(--flow-edge)",
        },
      }));
  }, [layout, highlight]);

  return (
    <div className="relative h-full w-full">
      <ErdContext.Provider value={focusColumn}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={erdEdgeTypes}
          className={cn("flow-canvas transition-opacity duration-200", ready ? "opacity-100" : "opacity-0")}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          // Node handlers also tell React Flow the nodes are interactive; without
          // any, it turns off pointer events on them and rows can't be hovered.
          onNodeMouseEnter={(_, node) => node.type === "table" && setFocus({ table: node.id })}
          onNodeMouseLeave={() => setFocus(null)}
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
      </ErdContext.Provider>

      <CanvasToolbar expanded={expanded} onToggleExpanded={onToggleExpanded} onFit={() => fit(200)} />
    </div>
  );
}

export default function ErdCanvas(props: ErdCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
