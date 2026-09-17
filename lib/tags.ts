import type { Tag, TagKind } from "./types";

/**
 * Single source of truth for tags. Frontmatter references these by id, so an
 * unknown tag surfaces as a warning in `getTag` rather than silently rendering.
 * Add new tags here and they appear in the filter bar automatically.
 */
const TAG_LIST: Tag[] = [
  // Concepts — the ideas being taught.
  { id: "fanout", label: "Fan-out", kind: "concept", description: "Delivering one event to many recipients, like a post to every follower." },
  { id: "consistency", label: "Consistency", kind: "concept", description: "Whether every reader sees the latest write, and how soon." },
  { id: "caching", label: "Caching", kind: "concept", description: "Keeping hot data in fast storage to skip slow lookups." },
  { id: "sharding", label: "Sharding", kind: "concept", description: "Splitting data across machines so no single node holds it all." },
  { id: "replication", label: "Replication", kind: "concept", description: "Keeping copies of data on several nodes for durability and read scale." },
  { id: "estimation", label: "Estimation", kind: "concept", description: "Back-of-the-envelope math for traffic, storage and capacity." },
  { id: "concurrency", label: "Concurrency", kind: "concept", description: "Keeping data correct when many requests touch it at once." },
  { id: "idempotency", label: "Idempotency", kind: "concept", description: "Repeating a request has the same effect as doing it once." },
  { id: "realtime", label: "Real-time", kind: "concept", description: "Pushing updates to clients the moment they happen." },
  { id: "geospatial", label: "Geospatial", kind: "concept", description: "Indexing and querying things by location on a map." },
  { id: "search", label: "Search", kind: "concept", description: "Finding documents by text, usually through an inverted index." },
  { id: "reliability", label: "Reliability", kind: "concept", description: "Staying up and correct when parts of the system fail." },
  { id: "observability", label: "Observability", kind: "concept", description: "Metrics, logs and traces that show what a system is doing." },
  { id: "security", label: "Security", kind: "concept", description: "Authentication, authorization and protecting data from abuse." },
  { id: "dedup", label: "Deduplication", kind: "concept", description: "Detecting and dropping repeated items or messages." },

  // Patterns — named architectural moves.
  { id: "event-driven", label: "Event-driven", kind: "pattern", description: "Services react to published events instead of calling each other." },
  { id: "cqrs", label: "CQRS", kind: "pattern", description: "Separate models for writing data and for reading it." },
  { id: "saga", label: "Saga", kind: "pattern", description: "A multi-step transaction undone by compensating steps on failure." },
  { id: "outbox", label: "Outbox", kind: "pattern", description: "Write the event to the database with the data, then publish it." },
  { id: "rate-limiting", label: "Rate limiting", kind: "pattern", description: "Capping how many requests a client can make per time window." },
  { id: "circuit-breaker", label: "Circuit breaker", kind: "pattern", description: "Stop calling a failing dependency until it recovers." },
  { id: "consistent-hashing", label: "Consistent hashing", kind: "pattern", description: "Mapping keys to nodes so adding a node moves few keys." },
  { id: "bloom-filter", label: "Bloom filter", kind: "pattern", description: "Compact set check that answers 'definitely not' or 'probably yes'." },
  { id: "stream-processing", label: "Stream processing", kind: "pattern", description: "Computing results continuously over unbounded event streams." },
  { id: "pagination", label: "Pagination", kind: "pattern", description: "Returning large result sets one page at a time." },
  { id: "chunking", label: "Chunking", kind: "pattern", description: "Splitting large files into pieces to upload, dedupe and sync." },
  { id: "crdt", label: "CRDT / OT", kind: "pattern", description: "Merging concurrent edits so every copy converges to the same state." },

  // Technology — concrete systems named in the doc.
  {
    id: "kafka",
    label: "Kafka",
    kind: "tech",
    description: "Distributed, partitioned commit log for streaming events between services.",
    features: [
      "Replayability: consumers rewind offsets",
      "Durable, replicated partitions",
      "Fault tolerant: leader failover",
      "High throughput, scales by partitions",
      "Ordering within a partition",
    ],
    useWhen: [
      "Streaming events between many services",
      "Replaying history to rebuild or backfill",
      "High-volume logs, metrics, clickstreams",
    ],
  },
  {
    id: "redis",
    label: "Redis",
    kind: "tech",
    description: "In-memory data store used for caches, counters, queues and pub/sub.",
    features: [
      "Sub-millisecond reads and writes",
      "Rich types: sorted sets, hashes, streams",
      "TTL expiry per key",
      "Atomic ops and Lua scripts",
      "Optional persistence and replicas",
    ],
    useWhen: [
      "Caching hot reads in front of a database",
      "Counters, rate limits, leaderboards",
      "Sessions and short-lived data with TTL",
    ],
  },
  {
    id: "cassandra",
    label: "Cassandra",
    kind: "tech",
    description: "Wide-column database built for heavy writes across many nodes.",
    features: [
      "Very fast writes (LSM tree)",
      "Masterless, no single point of failure",
      "Linear scaling by adding nodes",
      "Tunable consistency per query",
      "Multi-datacenter replication",
    ],
    useWhen: [
      "Write-heavy time series and activity feeds",
      "Always-on, multi-region data",
      "Access patterns known upfront by key",
    ],
  },
  {
    id: "postgres",
    label: "Postgres",
    kind: "tech",
    description: "Relational SQL database, the safe default for transactional data.",
    features: [
      "ACID transactions",
      "Joins, constraints, foreign keys",
      "Strong consistency",
      "Extensions: JSONB, PostGIS, full-text",
      "Read replicas via streaming replication",
    ],
    useWhen: [
      "Money, orders, anything needing transactions",
      "Relational data queried with joins",
      "The default until scale forces otherwise",
    ],
  },
  {
    id: "websockets",
    label: "WebSockets",
    kind: "tech",
    description: "Persistent two-way connection between browser and server.",
    features: [
      "Full-duplex over one TCP connection",
      "Server push, no polling",
      "Low per-message overhead",
      "Stateful: sticky, harder to load-balance",
    ],
    useWhen: [
      "Chat, live collaboration, multiplayer",
      "Live feeds, presence, notifications",
      "Server must push without being asked",
    ],
  },
  {
    id: "cdn",
    label: "CDN",
    kind: "tech",
    description: "Edge servers that serve content from close to the user.",
    features: [
      "Low latency from nearby edges",
      "Offloads traffic from the origin",
      "Caches static files and media",
      "Absorbs traffic spikes and DDoS",
    ],
    useWhen: [
      "Static assets, images and video",
      "Users spread far from your origin",
      "Cacheable API responses at the edge",
    ],
  },
  {
    id: "object-storage",
    label: "Object storage",
    kind: "tech",
    description: "Cheap, durable storage for files and blobs, like S3.",
    features: [
      "Extreme durability (11 nines)",
      "Virtually unlimited scale",
      "Low cost per GB, storage tiers",
      "Presigned URLs for direct uploads",
      "Whole-object writes, no in-place edits",
    ],
    useWhen: [
      "User uploads, media and backups",
      "Large files rather than queryable records",
      "Data lakes and long-term archives",
    ],
  },
  {
    id: "elasticsearch",
    label: "Elasticsearch",
    kind: "tech",
    description: "Distributed search engine built on inverted indexes.",
    features: [
      "Full-text search with relevance ranking",
      "Near real-time indexing",
      "Sharded and replicated",
      "Aggregations and faceting",
      "Fuzzy matching and autocomplete",
    ],
    useWhen: [
      "Full-text search and typeahead",
      "Searching and analyzing logs",
      "Filtering and faceting across many fields",
    ],
  },
  {
    id: "flink",
    label: "Flink",
    kind: "tech",
    description: "Stream processor for stateful, real-time computations.",
    features: [
      "Exactly-once state via checkpoints",
      "Event-time windows and watermarks",
      "Low-latency processing",
      "Large keyed state, fault tolerant",
    ],
    useWhen: [
      "Real-time aggregates and alerts",
      "Fraud or anomaly detection on streams",
      "Joining and windowing event streams",
    ],
  },
  {
    id: "olap",
    label: "OLAP",
    kind: "tech",
    description: "Analytical databases tuned for aggregating huge datasets.",
    features: [
      "Columnar storage and compression",
      "Fast aggregates over billions of rows",
      "Materialized views and rollups",
      "e.g. ClickHouse, Druid, BigQuery",
    ],
    useWhen: [
      "Dashboards over huge event tables",
      "Ad-hoc analytical queries",
      "Aggregations rather than per-row updates",
    ],
  },
  {
    id: "grpc",
    label: "gRPC",
    kind: "tech",
    description: "Fast RPC framework using Protocol Buffers over HTTP/2.",
    features: [
      "Compact binary payloads (Protobuf)",
      "HTTP/2 multiplexing",
      "Bidirectional streaming",
      "Typed contracts, generated clients",
      "Deadlines and cancellation",
    ],
    useWhen: [
      "Internal service-to-service calls",
      "Low-latency, high-volume RPC",
      "Streaming between backend services",
    ],
  },
  {
    id: "dynamodb",
    label: "DynamoDB",
    kind: "tech",
    description: "Managed key-value and document store with predictable latency at any size.",
    features: [
      "Single-digit ms reads by key",
      "No servers or rebalancing to run",
      "Conditional writes and transactions",
      "Streams for change capture",
      "Global tables for multi-region",
    ],
    useWhen: [
      "Key-based access at scale with no ops",
      "Sessions, carts, profiles, metadata",
      "Counters and idempotency via conditional writes",
    ],
  },
  {
    id: "memcached",
    label: "Memcached",
    kind: "tech",
    description: "Multithreaded in-memory cache that does nothing but get and set.",
    features: [
      "Multithreaded, very high throughput",
      "Tiny memory overhead per entry",
      "Pure LRU, no persistence",
      "Sharded by the client",
    ],
    useWhen: [
      "A pure look-aside cache of opaque blobs",
      "Cheapest bytes at very large fleet size",
      "No need for data types or durability",
    ],
  },
  {
    id: "api-gateway",
    label: "API gateway",
    kind: "tech",
    description: "The edge tier every external request passes through before it reaches a service.",
    features: [
      "TLS termination and routing",
      "Auth once, at the edge",
      "Per-client rate limits and quotas",
      "Timeouts, retries, circuit breaking",
      "One place for logs and metrics",
    ],
    useWhen: [
      "Any design with external clients",
      "Per-key rate limiting and quotas",
      "Hiding the service topology behind one host",
    ],
  },
  {
    id: "zookeeper",
    label: "ZooKeeper",
    kind: "tech",
    description: "Strongly consistent coordination store for leader election and membership.",
    features: [
      "Linearizable writes via quorum",
      "Ephemeral nodes tied to a session",
      "Watches push change notifications",
      "Small data only, not a database",
      "etcd and Consul are the alternatives",
    ],
    useWhen: [
      "Electing exactly one leader per shard",
      "Cluster membership and failure detection",
      "Assigning partitions to workers",
    ],
  },
];

const TAG_MAP = new Map(TAG_LIST.map((t) => [t.id, t]));

export const TAG_KIND_ORDER: TagKind[] = ["concept", "pattern", "tech"];

export const TAG_KIND_LABEL: Record<TagKind, string> = {
  concept: "Concept",
  pattern: "Pattern",
  tech: "Technology",
};

export function getTag(id: string): Tag {
  return TAG_MAP.get(id) ?? { id, label: id, kind: "concept" };
}

export function allTags(): Tag[] {
  return TAG_LIST;
}

/** Tags actually used by the given docs, grouped by facet, in registry order. */
export function tagsInUse(usedIds: string[]): Record<TagKind, Tag[]> {
  const used = new Set(usedIds);
  const grouped: Record<TagKind, Tag[]> = { concept: [], pattern: [], tech: [] };
  for (const tag of TAG_LIST) {
    if (used.has(tag.id)) grouped[tag.kind].push(tag);
  }
  return grouped;
}
