import type { Tag, TagKind } from "./types";

/**
 * Single source of truth for tags. Frontmatter references these by id, so an
 * unknown tag surfaces as a warning in `getTag` rather than silently rendering.
 * Add new tags here and they appear in the filter bar automatically.
 */
const TAG_LIST: Tag[] = [
  // Concepts — the ideas being taught.
  { id: "fanout", label: "Fan-out", kind: "concept" },
  { id: "consistency", label: "Consistency", kind: "concept" },
  { id: "caching", label: "Caching", kind: "concept" },
  { id: "sharding", label: "Sharding", kind: "concept" },
  { id: "replication", label: "Replication", kind: "concept" },
  { id: "estimation", label: "Estimation", kind: "concept" },
  { id: "concurrency", label: "Concurrency", kind: "concept" },
  { id: "idempotency", label: "Idempotency", kind: "concept" },
  { id: "realtime", label: "Real-time", kind: "concept" },
  { id: "geospatial", label: "Geospatial", kind: "concept" },
  { id: "search", label: "Search", kind: "concept" },
  { id: "reliability", label: "Reliability", kind: "concept" },
  { id: "observability", label: "Observability", kind: "concept" },
  { id: "security", label: "Security", kind: "concept" },
  { id: "dedup", label: "Deduplication", kind: "concept" },

  // Patterns — named architectural moves.
  { id: "event-driven", label: "Event-driven", kind: "pattern" },
  { id: "cqrs", label: "CQRS", kind: "pattern" },
  { id: "saga", label: "Saga", kind: "pattern" },
  { id: "outbox", label: "Outbox", kind: "pattern" },
  { id: "rate-limiting", label: "Rate limiting", kind: "pattern" },
  { id: "circuit-breaker", label: "Circuit breaker", kind: "pattern" },
  { id: "consistent-hashing", label: "Consistent hashing", kind: "pattern" },
  { id: "bloom-filter", label: "Bloom filter", kind: "pattern" },
  { id: "stream-processing", label: "Stream processing", kind: "pattern" },
  { id: "pagination", label: "Pagination", kind: "pattern" },
  { id: "chunking", label: "Chunking", kind: "pattern" },
  { id: "crdt", label: "CRDT / OT", kind: "pattern" },

  // Technology — concrete systems named in the doc.
  { id: "kafka", label: "Kafka", kind: "tech" },
  { id: "redis", label: "Redis", kind: "tech" },
  { id: "cassandra", label: "Cassandra", kind: "tech" },
  { id: "postgres", label: "Postgres", kind: "tech" },
  { id: "websockets", label: "WebSockets", kind: "tech" },
  { id: "cdn", label: "CDN", kind: "tech" },
  { id: "object-storage", label: "Object storage", kind: "tech" },
  { id: "elasticsearch", label: "Elasticsearch", kind: "tech" },
  { id: "flink", label: "Flink", kind: "tech" },
  { id: "olap", label: "OLAP", kind: "tech" },
  { id: "grpc", label: "gRPC", kind: "tech" },
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
