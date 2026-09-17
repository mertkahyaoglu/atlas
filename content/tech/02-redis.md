---
group: "tech"
order: 2
title: "Redis"
role: "In-memory store"
summary: "Sub-millisecond memory with useful data structures: caches, counters, locks, leaderboards and rate limits."
tags: ["redis", "caching", "rate-limiting", "concurrency", "dedup"]
---

# Redis

## Basics

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

## Key concepts and capabilities

The data structures are the reason to pick Redis over a plain cache. Each one
maps to a design problem:

| Type | What it gives you | Typical use |
| --- | --- | --- |
| String + `INCR` | Atomic counters | Rate limits, view counts |
| Hash | Fields of one object | Session, cached record |
| List | Push/pop at both ends | Simple queue, recent items |
| Set | Membership, intersection | Seen-ids, dedup, friends-of |
| Sorted set | Ordered by score | Leaderboards, time windows, priority queues |
| Stream | Append log with consumer groups | Lightweight message bus with acks |
| Bitmap / HyperLogLog | Compact counting | Daily actives, unique visitors at ~0.8% error |

**TTL and eviction.** Every key can expire. When memory fills, the eviction
policy decides what goes: `allkeys-lru` for a pure cache, `volatile-ttl` when some
keys must stay. A key can disappear at any moment, so nothing correctness-critical
may depend on it still being there.

**Atomicity in the large.** `INCR`, `SETNX` and friends are atomic on their own. For
a multi-step operation — check a token bucket, decrement it, set a TTL — use a Lua
script, which runs as one unit on the server. This is exactly how a production
rate limiter is written.

**Pub/sub vs Streams.** Pub/sub is fire-and-forget: a subscriber that is offline
misses the message. Streams keep history and support consumer groups with
acknowledgements. In a chat design, pub/sub is fine for routing a message to the
socket server holding a connection; it is not fine as the delivery guarantee.

**Pipelining.** Batching 100 commands into one round trip turns 100 network hops
into one. When someone asks how you fetch 500 cached feed entries, the answer is a
pipeline or an `MGET`, not a loop.

## When to use it in an interview

The five moments Redis is the right answer, and roughly in this order of how often
they come up:

1. **Cache-aside in front of a database.** Read the cache, miss, read Postgres, write back with a TTL. This is the single most common use, and the interesting part is the invalidation story, not the cache itself.
2. **Rate limiting.** A sorted set of request timestamps for a sliding window, or a token bucket in a Lua script. Redis is the shared state that makes the limit global rather than per-instance.
3. **Distributed coordination that tolerates being approximate.** Idempotency keys and dedup sets with a TTL, presence ("who is online"), and locks — with the caveat below.
4. **Ranked and windowed data.** Leaderboards, trending, the most recent N items of a feed, geospatial radius queries via `GEOSEARCH`.
5. **Sessions and short-lived state.** Anything keyed, small and expiring.

Redis is the wrong answer when the dataset does not fit in memory at a sane cost,
when you need durability guarantees, or when a query is anything other than a
lookup by key you chose in advance.

## What interviewers push on

- **Invalidation.** On write, do you delete the key or update it? Delete is usually right; updating races with concurrent writers. Say who invalidates and what happens if that step fails.
- **Cache stampede.** A hot key expires and a thousand requests hit the database at once. Fixes: jittered TTLs, a short lock so one request refills while others serve stale, or refreshing early in the background.
- **Hot keys.** One celebrity key can saturate a single shard no matter how many you add. Replicate it, cache it in the application process for a second, or split it across N sub-keys.
- **Locks.** `SET key val NX PX 30000` is a lock, but a paused process can wake up believing it still holds one. Redlock does not fix this. If the lock protects money, you need fencing tokens, or the lock belongs in the database instead.
- **Memory sizing.** Be ready with the arithmetic: rows × bytes per row × overhead, then decide the TTL. "About 200 bytes each, 10 million hot users, so roughly 2 GB" is the level of answer wanted.
- **What happens when Redis dies?** The correct answer is that the system gets slower, not wrong. If it gets wrong, Redis was holding the source of truth and should not have been.
