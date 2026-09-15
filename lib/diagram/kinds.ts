import type { FlowNode } from "./parse";

/**
 * What a diagram node is. Kind drives colour, icon and the general notes in
 * the detail dialog, so the same colour means the same thing on every page.
 */
export type NodeKind =
  | "service"
  | "store"
  | "database"
  | "cache"
  | "blob"
  | "queue"
  | "external"
  | "gateway"
  | "loadBalancer"
  | "terminal"
  | "decision";

export interface KindInfo {
  label: string;
  /** A CSS colour, always a theme token so both themes adapt. */
  tone: string;
  /** General notes, shown when the chart gives a node no role of its own. */
  purpose: string;
  tradeoff?: string;
  /** Kinds that only style a shape are left out of the legend. */
  inLegend: boolean;
}

export const KINDS: Record<NodeKind, KindInfo> = {
  service: {
    label: "Service",
    tone: "var(--ink-faint)",
    purpose: "Runs application logic. Usually stateless, so more instances can be added behind a load balancer.",
    tradeoff: "Every extra service is another network hop, deploy and failure point to trace a request through.",
    inLegend: false,
  },
  store: {
    label: "Data store",
    tone: "var(--ink-faint)",
    purpose: "Holds data that has to outlive a single request.",
    tradeoff: "State is what makes a tier hard to scale: it has to be partitioned, replicated and kept consistent.",
    inLegend: false,
  },
  database: {
    label: "Database",
    tone: "var(--tone-blue)",
    purpose: "The durable system of record. Data here survives restarts and is the source of truth other tiers derive from.",
    tradeoff: "The hardest tier to scale: sharding, replication lag and consistency choices all land here.",
    inLegend: true,
  },
  cache: {
    label: "Cache",
    tone: "var(--tone-red)",
    purpose: "Keeps hot data in memory to cut latency and shield the slower store behind it.",
    tradeoff: "Entries can be stale, and a cold or failed cache sends the full load to the origin at once.",
    inLegend: true,
  },
  blob: {
    label: "Object storage",
    tone: "var(--tone-yellow)",
    purpose: "Stores large immutable objects such as images, video and files cheaply, addressed by key.",
    tradeoff: "No queries or partial updates: objects are read and written whole, usually served through a CDN.",
    inLegend: true,
  },
  queue: {
    label: "Queue / stream",
    tone: "var(--tone-violet)",
    purpose: "Decouples producers from consumers, so work is buffered and processed asynchronously.",
    tradeoff: "Adds delay, and at-least-once delivery means consumers must handle duplicates idempotently.",
    inLegend: true,
  },
  external: {
    label: "External system",
    tone: "var(--tone-green)",
    purpose: "A third-party system outside our control, reached over the network.",
    tradeoff: "Its latency, rate limits and outages become ours, so calls need timeouts, retries and a fallback.",
    inLegend: true,
  },
  gateway: {
    label: "API gateway",
    tone: "var(--tone-teal)",
    purpose: "The single edge entry point: terminates TLS, authenticates, rate limits and routes requests.",
    tradeoff: "It sits on every request, so it must stay thin and highly available.",
    inLegend: true,
  },
  loadBalancer: {
    label: "Load balancer",
    tone: "var(--tone-pink)",
    purpose: "Spreads traffic across healthy instances and takes failed ones out of rotation.",
    tradeoff: "Must be redundant itself, and long-lived or sticky connections make the balance uneven.",
    inLegend: true,
  },
  terminal: {
    label: "Endpoint",
    tone: "var(--ink-muted)",
    purpose: "Where a flow starts or ends: a client, an incoming request or the response sent back.",
    inLegend: false,
  },
  decision: {
    label: "Decision",
    tone: "var(--ink-faint)",
    purpose: "A branch point. Which path a request takes depends on this condition.",
    inLegend: false,
  },
};

/** Emphasis layered on top of a kind, never a kind of its own. */
export const FLAGS = {
  hot: { label: "Focus", description: "The part of the design the deep dive is about." },
  scaled: { label: "Changed at scale", description: "New or reshaped compared with today's design." },
} as const;

const CLASS_KINDS: Record<string, NodeKind> = {
  db: "database",
  cache: "cache",
  blob: "blob",
  queue: "queue",
  external: "external",
  gateway: "gateway",
  lb: "loadBalancer",
};

export function nodeKind(node: FlowNode): NodeKind {
  const fromClass = node.classes.map((name) => CLASS_KINDS[name]).find(Boolean);
  if (fromClass) return fromClass;
  if (node.shape === "cylinder") return "store";
  if (node.shape === "stadium") return "terminal";
  if (node.shape === "diamond") return "decision";
  return "service";
}
