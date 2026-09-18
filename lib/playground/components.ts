import type { ComponentConfig, ComponentKind } from "./types";

export interface FieldDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Shown after the value: "rps", "sockets", "%". */
  unit?: string;
  /** Use a log-scale slider; values span orders of magnitude. */
  log?: boolean;
}

export interface ComponentDef {
  kind: ComponentKind;
  label: string;
  /** Theme token so both themes adapt. */
  tone: string;
  description: string;
  /** Slug of the tech or concept page that explains it, if any. */
  href?: string;
  defaults: ComponentConfig;
  fields: FieldDef[];
  /** Holds sockets open; connections stop here. */
  terminatesConnections: boolean;
  /** Counts as durable storage for the "is anything persisted?" check. */
  durable: boolean;
  /** Traffic starts here. */
  source: boolean;
}

const INSTANCES: FieldDef = { key: "instances", label: "Instances", min: 1, max: 5000, step: 1, log: true };
const RPS = (label = "Capacity per instance"): FieldDef => ({ key: "capacity", label, min: 100, max: 1_000_000, step: 100, unit: "rps", log: true });

export const COMPONENTS: Record<ComponentKind, ComponentDef> = {
  client: {
    kind: "client",
    label: "Clients",
    tone: "var(--ink-muted)",
    description: "Where traffic comes from. The workload sliders decide how much.",
    defaults: {},
    fields: [],
    terminatesConnections: false,
    durable: false,
    source: true,
  },
  cdn: {
    kind: "cdn",
    label: "CDN",
    tone: "var(--tone-green)",
    description: "Edge PoPs that absorb cacheable reads close to the user.",
    href: "11-cdn",
    defaults: { instances: 1, capacity: 500_000, hitRatio: 90 },
    fields: [INSTANCES, RPS(), { key: "hitRatio", label: "Hit ratio", min: 0, max: 100, step: 1, unit: "%" }],
    terminatesConnections: false,
    durable: false,
    source: false,
  },
  loadBalancer: {
    kind: "loadBalancer",
    label: "Load balancer",
    tone: "var(--tone-pink)",
    description: "Spreads traffic across healthy instances behind it.",
    defaults: { instances: 2, capacity: 200_000, connections: 1_000_000 },
    fields: [INSTANCES, RPS(), { key: "connections", label: "Sockets per instance", min: 1000, max: 10_000_000, step: 1000, unit: "sockets", log: true }],
    terminatesConnections: false,
    durable: false,
    source: false,
  },
  gateway: {
    kind: "gateway",
    label: "API gateway",
    tone: "var(--tone-teal)",
    description: "Terminates TLS, authenticates, rate limits and routes HTTP requests.",
    href: "12-api-gateway",
    defaults: { instances: 2, capacity: 20_000, connections: 100_000 },
    fields: [INSTANCES, RPS(), { key: "connections", label: "Sockets per instance", min: 1000, max: 1_000_000, step: 1000, unit: "sockets", log: true }],
    terminatesConnections: true,
    durable: false,
    source: false,
  },
  wsGateway: {
    kind: "wsGateway",
    label: "WebSocket gateway",
    tone: "var(--tone-teal)",
    description: "Holds long-lived sockets. Stateful: the scaling unit is sockets, not requests.",
    href: "13-websockets",
    defaults: { instances: 4, capacity: 10_000, connections: 50_000 },
    fields: [INSTANCES, RPS(), { key: "connections", label: "Sockets per instance", min: 1000, max: 1_000_000, step: 1000, unit: "sockets", log: true }],
    terminatesConnections: true,
    durable: false,
    source: false,
  },
  service: {
    kind: "service",
    label: "Service",
    tone: "var(--ink-faint)",
    description: "Stateless application logic. Add instances to scale.",
    defaults: { instances: 3, capacity: 2_000 },
    fields: [INSTANCES, RPS()],
    terminatesConnections: true,
    durable: false,
    source: false,
  },
  cache: {
    kind: "cache",
    label: "Cache",
    tone: "var(--tone-red)",
    description: "In-memory hot data. Only misses continue downstream.",
    href: "02-redis",
    defaults: { instances: 1, capacity: 100_000, hitRatio: 80 },
    fields: [INSTANCES, RPS("Ops per instance"), { key: "hitRatio", label: "Hit ratio", min: 0, max: 100, step: 1, unit: "%" }],
    terminatesConnections: true,
    durable: false,
    source: false,
  },
  database: {
    kind: "database",
    label: "Database",
    tone: "var(--tone-blue)",
    description: "The durable system of record. Instances here are shards.",
    href: "02-data-storage",
    defaults: { instances: 1, capacity: 5_000 },
    fields: [{ ...INSTANCES, label: "Shards" }, RPS("Writes per shard")],
    terminatesConnections: true,
    durable: true,
    source: false,
  },
  queue: {
    kind: "queue",
    label: "Queue / pub-sub",
    tone: "var(--tone-violet)",
    description: "Buffers and fans out. Each message leaves once per recipient.",
    href: "08-kafka",
    defaults: { instances: 3, capacity: 50_000 },
    fields: [{ ...INSTANCES, label: "Partitions" }, RPS("Msgs per partition")],
    terminatesConnections: true,
    durable: true,
    source: false,
  },
  blob: {
    kind: "blob",
    label: "Object storage",
    tone: "var(--tone-yellow)",
    description: "Large immutable objects, addressed by key.",
    href: "10-object-storage",
    defaults: { instances: 1, capacity: 5_000 },
    fields: [RPS("Requests per second")],
    terminatesConnections: true,
    durable: true,
    source: false,
  },
  external: {
    kind: "external",
    label: "External API",
    tone: "var(--tone-green)",
    description: "A third party with its own rate limit. Push providers, payment, email.",
    defaults: { instances: 1, capacity: 1_000 },
    fields: [RPS("Rate limit")],
    terminatesConnections: true,
    durable: false,
    source: false,
  },
};

/** Palette order: roughly the order a request meets them. */
export const PALETTE: ComponentKind[] = [
  "client",
  "cdn",
  "loadBalancer",
  "gateway",
  "wsGateway",
  "service",
  "cache",
  "queue",
  "database",
  "blob",
  "external",
];

export function defaultConfig(kind: ComponentKind): ComponentConfig {
  return { ...COMPONENTS[kind].defaults };
}
