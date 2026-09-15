"use client";

import { createContext, useContext } from "react";
import type { Direction } from "@/lib/diagram/parse";

export interface DiagramActions {
  direction: Direction;
  openNode: (id: string) => void;
  hoverNode: (id: string | null) => void;
}

export const DiagramContext = createContext<DiagramActions | null>(null);

/** Node components are rendered by React Flow, so they reach the canvas through context. */
export function useDiagram(): DiagramActions {
  const actions = useContext(DiagramContext);
  if (!actions) throw new Error("Diagram nodes must be rendered inside a FlowCanvas");
  return actions;
}
