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
capabilities:
  - title: "The data structures are the reason to pick it"
    body: |-
      | Type | What it gives you | Typical use |
      | --- | --- | --- |
      | String + `INCR` | Atomic counters | Rate limits, view counts |
      | Hash | Fields of one object | Session, cached record |
      | List | Push/pop at both ends | Simple queue, recent items |
      | Set | Membership, intersection | Seen-ids, dedup, friends-of |
      | Sorted set | Ordered by score | Leaderboards, time windows, priority queues |
      | Stream | Append log with consumer groups | Lightweight message bus with acks |
      | Bitmap / HyperLogLog | Compact counting | Daily actives, unique visitors at ~0.8% error |
  - title: "TTL and eviction"
    body: |-
      Every key can expire. When memory fills, the eviction policy decides what goes: `allkeys-lru` for a pure cache, `volatile-ttl` when some keys must stay.

      A key can disappear at any moment, so nothing correctness-critical may depend on it still being there.
  - title: "Atomicity in the large"
    body: |-
      `INCR`, `SETNX` and friends are atomic on their own. For a multi-step operation — check a token bucket, decrement it, set a TTL — use a Lua script, which runs as one unit on the server.

      This is exactly how a production rate limiter is written.
  - title: "Pub/sub vs Streams"
    body: |-
      Pub/sub is fire-and-forget: a subscriber that is offline misses the message. Streams keep history and support consumer groups with acknowledgements.

      In a chat design, pub/sub is fine for routing a message to the socket server holding a connection; it is not fine as the delivery guarantee.
  - title: "Pipelining"
    body: |-
      Batching 100 commands into one round trip turns 100 network hops into one. When someone asks how you fetch 500 cached feed entries, the answer is a pipeline or an `MGET`, not a loop.
useWhen:
  - "**Cache-aside in front of a database** — the most common use by far, where the interesting part is the invalidation story"
  - "**Rate limiting**: the shared state that makes a limit global rather than per-instance"
  - "**Coordination that tolerates being approximate**: idempotency keys, dedup sets with a TTL, presence, locks"
  - "**Ranked and windowed data**: leaderboards, trending, the most recent N items, `GEOSEARCH` radius queries"
  - "**Sessions and short-lived state** — anything keyed, small and expiring"
avoidWhen:
  - "The dataset does not fit in memory at a sane cost"
  - "You need durability guarantees: a crash may drop the last second of writes"
  - "The query is anything other than a lookup by a key you chose in advance"
  - "Losing it would make the system *wrong* rather than slow — then it was holding the source of truth"
probes:
  - question: "On write, do you delete the cached key or update it?"
    answer: "Delete is usually right; updating races with concurrent writers. Say who invalidates and what happens if that step fails."
  - question: "A hot key expires and a thousand requests hit the database at once."
    answer: "Cache stampede. Jittered TTLs, a short lock so one request refills while the others serve stale, or refreshing early in the background."
  - question: "One celebrity key saturates a shard. More shards don't help. Why?"
    answer: "A single key lives on a single shard. Replicate it, cache it in the application process for a second, or split it across N sub-keys and pick one at random."
  - question: "Is `SET key val NX PX 30000` a lock?"
    answer: "It is, until a paused process wakes up believing it still holds one. Redlock does not fix that. If the lock protects money, you need fencing tokens, or the lock belongs in the database."
  - question: "How much memory will this need?"
    answer: "Do the arithmetic out loud: rows × bytes per row × overhead, then pick the TTL. \"About 200 bytes each, 10 million hot users, so roughly 2 GB\" is the level wanted."
  - question: "What happens when Redis dies?"
    answer: "The system gets slower, not wrong. If it would get wrong, Redis was holding the source of truth and should not have been."
---

# Redis

## How it works

Redis keeps its whole dataset in memory and serves commands from a single thread
per shard. That sounds like a limitation and is actually the feature: because one
command runs at a time, every operation is atomic without you taking a lock.
Reads and writes land in the tens of microseconds; a network round trip is the
dominant cost.

Durability is optional and worth understanding, because it decides whether Redis
is a cache or a store. **RDB** takes periodic point-in-time snapshots; **AOF**
appends every write to a log, fsynced every second by default. Either way a crash
can lose the last second of writes. Treat Redis as authoritative only for data
you can afford to lose or rebuild.

For availability, a primary replicates asynchronously to replicas and Sentinel
promotes one on failure. For size, **Redis Cluster** hashes keys into 16,384 slots
spread over shards; multi-key operations only work when the keys live in the same
slot, which is what hash tags (`user:{123}:feed`) are for.

## Cache-aside, the shape you will draw

```mermaid
flowchart TB
    App([Service]) -- "1 · GET user:42" --> R{{"Redis<br/>one command at a time<br/>so every op is atomic"}}
    R -- "hit · tens of µs" --> App
    R -. "miss" .-> App
    App -- "2 · read on miss" --> DB[("Postgres<br/>source of truth")]
    App -- "3 · SET user:42 EX 300" --> R
    R --> AOF["RDB / AOF<br/>fsync ~1s: a crash loses the tail"]
    R --> Replica[("Replica<br/>async · Sentinel promotes")]

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class DB,Replica db
    class R cache
    class R hot
```

Three steps, and the third one is where the interview goes: what TTL, who
deletes the key on write, and what a thousand simultaneous misses do to the
database behind it.

## The rate limiter, in one Lua script

The token bucket is the canonical multi-step operation, and it is why Lua
scripts exist: read the bucket, refill it by elapsed time, spend a token and
re-arm the TTL, all as one unit on the server with no lock and no race.

```erd
# Rate limiting · Redis
rl:{identity}:{endpoint} || refilled lazily on read; TTL = the window, so idle keys evict themselves || Redis hash
+ tokens || int
+ last_refill_ts || timestamp
window:{identity} || one member per request; ZREMRANGEBYSCORE trims the window before counting || sorted set
+ member || request_id
+ score || timestamp
```
