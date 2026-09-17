---
group: "tech"
order: 3
title: "Memcached"
role: "Cache"
summary: "A cache that does nothing but get and set — fewer features than Redis, and that is the argument for it."
tags: ["memcached", "caching", "consistent-hashing"]
---

# Memcached

## Basics

Memcached is a distributed in-memory cache with one data model: an opaque byte
blob under a string key, with an optional expiry. No lists, no sorted sets, no
persistence, no replication, no cluster membership. A server is a bag of memory
that forgets things.

Two design choices matter. It is **multithreaded**, so a single node uses all its
cores and pushes more raw operations per second per box than single-threaded
Redis. And its memory is managed by a **slab allocator**: memory is carved into
size classes, and an item goes into the class that fits. That avoids
fragmentation, at the cost of wasting the gap between an item's size and its class,
and of one class being unable to borrow memory from another.

There is no cluster. Clients hold the server list and pick a node by **consistent
hashing**, so adding a node moves only its share of keys instead of reshuffling
everything. The cluster's only failure mode is a cold node.

## Key concepts and capabilities

**The whole API.** `get`, `set`, `add`, `delete`, `incr`/`decr`, and `cas`. `cas`
(check-and-set) returns a version with each read and rejects a write whose version
is stale — the one primitive for safe read-modify-write.

**Nothing is replicated.** Lose a node and you lose its keys. For a look-aside
cache that is a latency event, not a correctness one, which is precisely why the
missing features are acceptable.

**Leases, for the stampede.** The classic answer to a hot key expiring under load
comes from Facebook's memcache paper: on a miss, hand exactly one client a lease
token and let it refill while everyone else briefly serves the stale value. It is
worth knowing as a named technique — it is the same idea you would implement in
Redis with a short lock.

**Memcached vs Redis**, which is the actual question you will be asked:

| | Memcached | Redis |
| --- | --- | --- |
| Data model | Opaque blobs | Strings, hashes, sets, sorted sets, streams |
| Threads | Multithreaded | Single-threaded per shard |
| Persistence | None | RDB / AOF, optional |
| Replication | None | Primary/replica + Sentinel |
| Sharding | Client-side hashing | Redis Cluster |
| Best at | Cheap, huge, simple caching | Everything that is not just a cache |

## When to use it in an interview

Name Memcached when the requirement really is *only* caching, at a size where the
per-byte cost and per-core throughput matter: rendered HTML fragments, serialized
API responses, database query results in a fleet with thousands of cache nodes.
The large-scale caching papers that interviewers know are about Memcached, so it
is a credible choice for exactly that shape of problem.

In practice, most designs are better served by Redis, because sooner or later you
want a counter, a sorted set or a TTL-scoped set, and running one system beats
running two. The valuable interview move is not choosing Memcached — it is being
able to answer "why Redis and not Memcached?" in one sentence: *I need data
structures and optional durability, not just a blob cache; if I only needed get
and set at enormous scale, Memcached would be cheaper.*

## What interviewers push on

- **Why not Memcached?** Have the one-line answer above ready. An unexamined "Redis because everyone uses Redis" is the weak version.
- **What happens when a cache node dies?** With client-side consistent hashing, its share of keys misses and the database takes that load. Size the database for a partial cache loss, or use a second cache tier.
- **Stampede control.** Leases, stale-while-revalidate, jittered TTLs — the same toolkit as Redis, and the interviewer wants to hear one of them named.
- **Item size limits.** The default cap is 1 MB per value. Large objects belong in object storage with the cache holding the pointer.
- **Slab calorimetry.** If your item sizes shift over time, memory can be stranded in the wrong size class. It is an operational detail, but knowing it exists signals real familiarity.
