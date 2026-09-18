"use client";

import { createContext, useContext } from "react";
import type { SimResult } from "@/lib/playground/types";

export const EMPTY_RESULT: SimResult = { nodes: {}, edges: {}, issues: [], holds: false };

/** The latest simulation, read by nodes and edges to style themselves. */
export const SimContext = createContext<SimResult>(EMPTY_RESULT);

export function useSim() {
  return useContext(SimContext);
}
