"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";
import { COMPONENTS, defaultConfig } from "@/lib/playground/components";
import { CHAT_PRESETS, CHAT_STARTER } from "@/lib/playground/scenarios/chat";
import type { ComponentConfig, ComponentKind, PlaygroundEdge, PlaygroundNode, Workload } from "@/lib/playground/types";

interface PlaygroundState {
  nodes: PlaygroundNode[];
  edges: PlaygroundEdge[];
  workload: Workload;
  /** Preset id, or null once a slider moved off it. */
  preset: string | null;
  selectedId: string | null;

  onNodesChange: (changes: NodeChange<PlaygroundNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<PlaygroundEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (kind: ComponentKind, position: XYPosition) => string;
  updateNode: (id: string, patch: { name?: string; config?: ComponentConfig }) => void;
  removeNode: (id: string) => void;
  select: (id: string | null) => void;
  setWorkload: (patch: Partial<Workload>) => void;
  applyPreset: (id: string) => void;
  loadStarter: () => void;
  clear: () => void;
}

let counter = 0;
function nextId(kind: ComponentKind) {
  counter += 1;
  return `${kind}-${Date.now().toString(36)}${counter}`;
}

export const usePlaygroundStore = create<PlaygroundState>()(
  persist(
    (set, get) => ({
      nodes: CHAT_STARTER.nodes,
      edges: CHAT_STARTER.edges,
      workload: CHAT_PRESETS[0].workload,
      preset: CHAT_PRESETS[0].id,
      selectedId: null,

      onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
      onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
      onConnect: (connection) => {
        if (connection.source === connection.target) return;
        set({ edges: addEdge<PlaygroundEdge>({ ...connection, type: "traffic" }, get().edges) });
      },
      addNode: (kind, position) => {
        const id = nextId(kind);
        const sameKind = get().nodes.filter((n) => n.data.kind === kind).length;
        const name = sameKind ? `${COMPONENTS[kind].label} ${sameKind + 1}` : COMPONENTS[kind].label;
        const node: PlaygroundNode = { id, type: "component", position, data: { kind, name, config: defaultConfig(kind) } };
        set({ nodes: [...get().nodes, node] });
        return id;
      },
      updateNode: (id, patch) =>
        set({
          nodes: get().nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, ...(patch.name !== undefined && { name: patch.name }), ...(patch.config && { config: patch.config }) } } : n,
          ),
        }),
      removeNode: (id) =>
        set({
          nodes: get().nodes.filter((n) => n.id !== id),
          edges: get().edges.filter((e) => e.source !== id && e.target !== id),
          selectedId: get().selectedId === id ? null : get().selectedId,
        }),
      select: (selectedId) => set({ selectedId }),
      setWorkload: (patch) => set({ workload: { ...get().workload, ...patch }, preset: null }),
      applyPreset: (id) => {
        const preset = CHAT_PRESETS.find((p) => p.id === id);
        if (preset) set({ workload: preset.workload, preset: id });
      },
      loadStarter: () => set({ nodes: CHAT_STARTER.nodes, edges: CHAT_STARTER.edges, selectedId: null }),
      clear: () => set({ nodes: [], edges: [], selectedId: null }),
    }),
    {
      name: "atlas-playground",
      partialize: (s) => ({ nodes: s.nodes, edges: s.edges, workload: s.workload, preset: s.preset }),
    },
  ),
);
