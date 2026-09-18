import type { Edge, Node } from "@xyflow/react";

export type ComponentKind =
  | "client"
  | "cdn"
  | "loadBalancer"
  | "gateway"
  | "wsGateway"
  | "service"
  | "cache"
  | "database"
  | "queue"
  | "blob"
  | "external";

/** Every tunable is a number, keyed by the field id in the catalogue. */
export type ComponentConfig = Record<string, number>;

export interface PlaygroundNodeData extends Record<string, unknown> {
  kind: ComponentKind;
  name: string;
  config: ComponentConfig;
}

export type PlaygroundNode = Node<PlaygroundNodeData, "component">;
export type PlaygroundEdge = Edge<Record<string, never>, "traffic">;

export interface Workload {
  /** Messages (requests) entering the system per second. */
  rps: number;
  /** Concurrent client connections held open. */
  connections: number;
  /** Recipients per message: how much a queue / pub-sub multiplies traffic. */
  fanout: number;
}

export type NodeStatus = "idle" | "ok" | "warm" | "hot" | "overloaded";

export interface NodeStats {
  /** Requests per second arriving. */
  rpsIn: number;
  /** Requests per second this node could handle. */
  rpsCapacity: number;
  /** Requests per second dropped because capacity ran out. */
  shed: number;
  /** Requests per second leaving along outgoing edges (all edges combined). */
  rpsOut: number;
  connectionsIn: number;
  connectionsCapacity: number;
  /** max(rps, connections) utilization, 0..∞ */
  utilization: number;
  status: NodeStatus;
}

export interface EdgeStats {
  rps: number;
  connections: number;
}

export interface Issue {
  severity: "error" | "warning";
  nodeId?: string;
  message: string;
}

export interface SimResult {
  nodes: Record<string, NodeStats>;
  edges: Record<string, EdgeStats>;
  issues: Issue[];
  /** True when nothing is overloaded and the structure is sound. */
  holds: boolean;
}
