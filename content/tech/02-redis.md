---
group: "tech"
order: 2
title: "Redis"
role: "In-memory store"
summary: "Sub-millisecond memory with useful data structures: caches, counters, locks, leaderboards and rate limits."
tags: ["redis", "caching", "rate-limiting", "concurrency", "dedup"]
facts:
  - label: "Model"
    value: "Keys holding real data structures, not just blobs"
  - label: "Threading"
    value: "One command at a time per shard, so operations are atomic without locks"
  - label: "Latency"
    value: "Tens of microseconds; the network round trip dominates"
  - label: "Durability"
    value: "Optional RDB snapshots or AOF; a crash can lose the last second"
  - label: "Availability"
    value: "Async replicas, Sentinel promotes on failure"
  - label: "Sharding"
    value: "Redis Cluster, 16,384 slots; hash tags keep related keys together"
concepts:
  - "**Data structures are the point** — strings and `INCR`, hashes, lists, sets, sorted sets, streams, bitmaps and HyperLogLog"
  - "**Single-threaded per shard** — one command at a time, so every operation is atomic with no lock of your own"
  - "**Lua for multi-step work** — check a bucket, decrement it, re-arm the TTL, all as one unit on the server"
  - "**TTL and eviction** — every key can expire; `allkeys-lru` for a pure cache, `volatile-ttl` when some keys must stay"
  - "**Nothing may depend on a key existing** — it can be evicted at any moment"
  - "**Pub/sub is fire-and-forget**; Streams keep history and support consumer groups with acks"
  - "**Pipelining** — 100 commands in one round trip, because the round trip is the cost"
  - "**Durability is optional** — RDB snapshots or AOF fsynced ~1s, so treat it as authoritative only for rebuildable data"
  - "**Cluster hash tags** — `user:{123}:feed` keeps related keys in one slot so multi-key commands work"
---

# Redis

## Use cases

### Cache-aside in front of a database

The most common use by far, and the interesting part is never the cache itself:
it is the TTL, who deletes the key on write, and what a thousand simultaneous
misses do to the database behind it.

```mermaid
flowchart TB
    App([Service]) -- "1 · GET user:42" --> R{{"Redis<br/>one command at a time"}}
    R -- "hit · tens of µs" --> App
    R -. "miss" .-> App
    App -- "2 · read on miss" --> DB[("Postgres<br/>source of truth")]
    App -- "3 · SET user:42 EX 300" --> R
    App -. "on write: DELETE the key<br/>never update it in place" .-> R

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class DB db
    class R cache
    class R hot
```

### Rate limiting that is actually global

Counters in each application instance let through N times your limit. One Redis
holds the bucket for every instance, and a Lua script makes refill-and-spend a
single atomic step. The TTL is the window, so idle keys evict themselves and
there is no cleanup job.

```erd
# Token bucket · Redis
rl:{identity}:{endpoint} || refilled lazily on read, spent in one Lua script; TTL = the window || Redis hash
+ tokens || int
+ last_refill_ts || timestamp
# Sliding window · the alternative
window:{identity} || one member per request; ZREMRANGEBYSCORE trims the window before counting || sorted set
+ member || request_id
+ score || timestamp
```

### Leaderboards, trending and "the last N"

A sorted set keeps members ordered by score for free, so the top ten is a range
read rather than a scan and a sort. The same structure holds a time window: score
by timestamp, trim the old end, and the set is always "the last five minutes".

```mermaid
flowchart TB
    Game([Score submitted]) -- "ZADD leaderboard 4820 user:42" --> Z{{"Sorted set<br/>ordered by score"}}
    Z -- "ZREVRANGE 0 9<br/>top ten, O(log n)" --> UI([Leaderboard page])
    Z -- "ZREVRANK user:42<br/>this player's position" --> UI
    Trim["ZREMRANGEBYSCORE<br/>drop anything older than 5 min"] --> Z
    Z -- "same structure" --> Window([Trending in the last 5 minutes])

    classDef cache fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Z cache
    class Z hot
```

### A doorbell for a socket tier

Pub/sub is how a message reaches the one server holding a user's connection
without a registry lookup. It is a doorbell, not a delivery guarantee: the
message is already durable before the publish, and a missed publish is repaired
by the client's reconnect.

```mermaid
flowchart TB
    Svc["Chat service"] -- "1 · persist" --> DB[("Store")]
    Svc -- "2 · PUBLISH user:B" --> PS{{"Redis pub/sub"}}
    PS -- "only the subscriber gets it" --> N2["Socket node 7<br/>holds B's connection"]
    PS -. "nobody subscribed → dropped" .-> N1["Socket node 1"]
    N2 --> B([User B])
    B -. "reconnect with last_seen_id" .-> Svc

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class DB db
    class PS cache
    class Svc hot
```
