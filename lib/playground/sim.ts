/**
 * Steady-state simulation. Given the graph and the workload it answers, in one
 * pass, how much traffic lands on every node and edge and whether the system
 * holds. It's a pure function so it can be unit tested and, later, wrapped in
 * a tick loop: `processNode` is the per-node step that loop would repeat with
 * a queue depth carried between ticks.
 */

import { COMPONENTS } from "./components";
import type {
  EdgeStats,
  Issue,
  NodeStats,
  NodeStatus,
  PlaygroundEdge,
  PlaygroundNode,
  SimResult,
  Workload,
} from "./types";

export const THRESHOLDS = { warm: 0.7, hot: 0.9, overloaded: 1 } as const;

export function statusFor(utilization: number, load: number): NodeStatus {
  if (load <= 0) return "idle";
  if (utilization >= THRESHOLDS.overloaded) return "overloaded";
  if (utilization >= THRESHOLDS.hot) return "hot";
  if (utilization >= THRESHOLDS.warm) return "warm";
  return "ok";
}

interface Inflow {
  rps: number;
  connections: number;
}

/**
 * One node's step: what it can process, what it sheds, what continues.
 * Sources inject the workload; everything else is bounded by capacity.
 */
export function processNode(node: PlaygroundNode, inflow: Inflow, workload: Workload) {
  const def = COMPONENTS[node.data.kind];
  const cfg = node.data.config;

  if (def.source) {
    return {
      rpsCapacity: Infinity,
      connectionsCapacity: Infinity,
      processed: workload.rps,
      shed: 0,
      out: { rps: workload.rps, connections: workload.connections },
    };
  }

  const instances = Math.max(1, cfg.instances ?? 1);
  const rpsCapacity = instances * (cfg.capacity ?? Infinity);
  const connectionsCapacity = cfg.connections !== undefined ? instances * cfg.connections : Infinity;

  const processed = Math.min(inflow.rps, rpsCapacity);
  const shed = inflow.rps - processed;

  let rpsOut = processed;
  if (cfg.hitRatio !== undefined) rpsOut = processed * (1 - cfg.hitRatio / 100);
  if (def.kind === "queue") rpsOut = processed * Math.max(1, workload.fanout);

  const connectionsOut = def.terminatesConnections ? 0 : Math.min(inflow.connections, connectionsCapacity);

  return { rpsCapacity, connectionsCapacity, processed, shed, out: { rps: rpsOut, connections: connectionsOut } };
}

/** Edges that close a cycle, found by DFS; they carry no traffic. */
function backEdges(nodes: PlaygroundNode[], edges: PlaygroundEdge[]): Set<string> {
  const out = new Map<string, PlaygroundEdge[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e]);
  const state = new Map<string, 1 | 2>();
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.target);
      if (s === 1) back.add(e.id);
      else if (!s) visit(e.target);
    }
    state.set(id, 2);
  };
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);
  return back;
}

export function simulate(nodes: PlaygroundNode[], edges: PlaygroundEdge[], workload: Workload): SimResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const live = edges.filter((e) => byId.has(e.source) && byId.has(e.target) && e.source !== e.target);
  const back = backEdges(nodes, live);
  const forward = live.filter((e) => !back.has(e.id));

  // Kahn's algorithm over the acyclic forward edges.
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  const outgoing = new Map<string, PlaygroundEdge[]>();
  for (const e of forward) {
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e]);
  }
  const order: string[] = [];
  const ready = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const e of outgoing.get(id) ?? []) {
      const d = (indegree.get(e.target) ?? 1) - 1;
      indegree.set(e.target, d);
      if (d === 0) ready.push(e.target);
    }
  }

  const inflow = new Map<string, Inflow>(nodes.map((n) => [n.id, { rps: 0, connections: 0 }]));
  const nodeStats: Record<string, NodeStats> = {};
  const edgeStats: Record<string, EdgeStats> = {};
  for (const e of live) edgeStats[e.id] = { rps: 0, connections: 0 };

  for (const id of order) {
    const node = byId.get(id)!;
    const flow = inflow.get(id)!;
    const step = processNode(node, flow, workload);
    const outs = outgoing.get(id) ?? [];
    const share = outs.length ? 1 / outs.length : 0;
    for (const e of outs) {
      const stats = { rps: step.out.rps * share, connections: step.out.connections * share };
      edgeStats[e.id] = stats;
      const next = inflow.get(e.target)!;
      next.rps += stats.rps;
      next.connections += stats.connections;
    }
    const rpsUtil = step.rpsCapacity === Infinity ? 0 : flow.rps / step.rpsCapacity;
    const connUtil = step.connectionsCapacity === Infinity ? 0 : flow.connections / step.connectionsCapacity;
    const utilization = Math.max(rpsUtil, connUtil);
    nodeStats[id] = {
      rpsIn: flow.rps,
      rpsCapacity: step.rpsCapacity,
      shed: step.shed,
      rpsOut: outs.length ? step.out.rps : 0,
      connectionsIn: flow.connections,
      connectionsCapacity: step.connectionsCapacity,
      utilization,
      status: COMPONENTS[node.data.kind].source ? "idle" : statusFor(utilization, flow.rps + flow.connections),
    };
  }

  const issues = structuralIssues(nodes, forward, nodeStats, workload);
  for (const n of nodes) {
    const s = nodeStats[n.id];
    if (!s) continue;
    if (s.status === "overloaded") {
      const bySockets = s.connectionsCapacity !== Infinity && s.connectionsIn / s.connectionsCapacity >= s.rpsIn / s.rpsCapacity;
      issues.push({
        severity: "error",
        nodeId: n.id,
        message: bySockets
          ? `${n.data.name} is at ${Math.round(s.utilization * 100)}%: ${fmt(s.connectionsIn)} sockets for ${fmt(s.connectionsCapacity)} of capacity.`
          : `${n.data.name} is at ${Math.round(s.utilization * 100)}% and shedding ${fmt(s.shed)} rps.`,
      });
    } else if (s.status === "hot") {
      issues.push({ severity: "warning", nodeId: n.id, message: `${n.data.name} is at ${Math.round(s.utilization * 100)}%: no headroom for a spike.` });
    }
  }

  return { nodes: nodeStats, edges: edgeStats, issues, holds: !issues.some((i) => i.severity === "error") };
}

function structuralIssues(
  nodes: PlaygroundNode[],
  forward: PlaygroundEdge[],
  stats: Record<string, NodeStats>,
  workload: Workload,
): Issue[] {
  const issues: Issue[] = [];
  const sources = nodes.filter((n) => COMPONENTS[n.data.kind].source);
  if (sources.length === 0) {
    issues.push({ severity: "error", message: "No clients: drag Clients onto the canvas so traffic has somewhere to start." });
    return issues;
  }

  // Everything reachable from a source, following forward edges.
  const out = new Map<string, string[]>();
  for (const e of forward) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const reached = new Set<string>();
  const stack = sources.map((s) => s.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const t of out.get(id) ?? []) stack.push(t);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const reachedDefs = [...reached].map((id) => COMPONENTS[byId.get(id)!.data.kind]);
  if (![...reached].some((id) => !COMPONENTS[byId.get(id)!.data.kind].source)) {
    issues.push({ severity: "error", message: "Clients aren't connected to anything. Drag from a node's right handle to wire it up." });
    return issues;
  }
  if (!reachedDefs.some((d) => d.durable)) {
    issues.push({ severity: "error", message: "Nothing durable is reachable: messages would be lost. Add a database or queue." });
  }
  if (workload.connections > 0 && !reachedDefs.some((d) => d.terminatesConnections)) {
    issues.push({ severity: "error", message: "Connections have nowhere to terminate. Add a gateway or service." });
  }
  for (const n of nodes) {
    if (!reached.has(n.id) && !COMPONENTS[n.data.kind].source) {
      issues.push({ severity: "warning", nodeId: n.id, message: `${n.data.name} receives no traffic.` });
    }
  }
  void stats;
  return issues;
}

/** 1234 → "1.2k", 4_000_000 → "4M". */
export function fmt(n: number): string {
  if (!isFinite(n)) return "∞";
  if (n >= 1e9) return `${trim(n / 1e9)}B`;
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e3) return `${trim(n / 1e3)}k`;
  return trim(n);
}
function trim(n: number) {
  return n >= 100 ? String(Math.round(n)) : n >= 10 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(n % 1 ? 1 : 0);
}
