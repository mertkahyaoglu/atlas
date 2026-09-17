---
group: "tech"
order: 3
title: "Memcached"
role: "Cache"
summary: "A cache that does nothing but get and set — fewer features than Redis, and that is the argument for it."
tags: ["memcached", "caching", "consistent-hashing"]
facts:
  - label: "Model"
    value: "One opaque blob under a string key, with an expiry"
  - label: "Threads"
    value: "Multithreaded: more raw ops per second per box than Redis"
  - label: "Memory"
    value: "Slab allocator, fixed size classes, no fragmentation"
  - label: "Cluster"
    value: "None — the client picks a node by consistent hashing"
  - label: "Durability"
    value: "None, and no replication: a dead node is a cold node"
  - label: "Value size"
    value: "1 MB by default; anything bigger belongs in object storage"
capabilities:
  - title: "The whole API"
    body: |-
      `get`, `set`, `add`, `delete`, `incr`/`decr`, and `cas`.

      `cas` (check-and-set) returns a version with each read and rejects a write whose version is stale — the one primitive for safe read-modify-write.
  - title: "Nothing is replicated"
    body: |-
      Lose a node and you lose its keys. For a look-aside cache that is a latency event, not a correctness one, which is precisely why the missing features are acceptable.
  - title: "Leases, for the stampede"
    body: |-
      The classic answer to a hot key expiring under load comes from Facebook's memcache paper: on a miss, hand exactly one client a lease token and let it refill while everyone else briefly serves the stale value.

      Worth knowing as a named technique — it is the same idea you would implement in Redis with a short lock.
  - title: "Memcached vs Redis, the question you will actually be asked"
    body: |-
      | | Memcached | Redis |
      | --- | --- | --- |
      | Data model | Opaque blobs | Strings, hashes, sets, sorted sets, streams |
      | Threads | Multithreaded | Single-threaded per shard |
      | Persistence | None | RDB / AOF, optional |
      | Replication | None | Primary/replica + Sentinel |
      | Sharding | Client-side hashing | Redis Cluster |
      | Best at | Cheap, huge, simple caching | Everything that is not just a cache |
useWhen:
  - "The requirement really is *only* caching: rendered HTML fragments, serialized API responses, query results"
  - "Per-byte cost and per-core throughput matter, in a fleet with thousands of cache nodes"
  - "You want to invoke the large-scale caching papers interviewers know, which are about Memcached"
avoidWhen:
  - "Sooner or later you want a counter, a sorted set or a TTL-scoped set — that is Redis, and one system beats two"
  - "You need any durability or replication"
  - "Values exceed the 1 MB item cap"
probes:
  - question: "Why Redis and not Memcached?"
    answer: "One sentence: *I need data structures and optional durability, not just a blob cache; if I only needed get and set at enormous scale, Memcached would be cheaper.* An unexamined \"Redis because everyone uses Redis\" is the weak version."
  - question: "What happens when a cache node dies?"
    answer: "With client-side consistent hashing, its share of keys misses and the database takes that load. Size the database for a partial cache loss, or add a second cache tier."
  - question: "How do you stop a stampede?"
    answer: "Leases, stale-while-revalidate, jittered TTLs — the same toolkit as Redis. The interviewer wants one of them named."
  - question: "Where do large objects go?"
    answer: "Object storage, with the cache holding the pointer. The default item cap is 1 MB."
  - question: "Your item sizes drifted over time and hit rate fell. Why?"
    answer: "Slab calorimetry: memory is stranded in the wrong size class and cannot be borrowed by another. An operational detail, but knowing it exists signals real familiarity."
---

# Memcached

## How it works

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

## There is no cluster — the client is the router

```mermaid
flowchart TB
    App(["App fleet<br/>holds the server list"]) -- "hash(key) → ring position" --> Ring{"Consistent hash ring"}
    Ring --> N1["memcached #1<br/>its share of keys"]
    Ring --> N2["memcached #2<br/>its share of keys"]
    Ring --> N3["memcached #3<br/>dies → only its share is cold"]
    N3 -. "those keys miss" .-> DB[("Database<br/>must absorb the extra load")]

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class DB db
    class N3 hot
```

Adding a node moves only its share of keys instead of reshuffling everything,
which is the whole reason consistent hashing is here. The cluster's only failure
mode is a cold node — so the question is always whether the database behind it
survives that.

## Where it fits in a design

Name Memcached when the size and the simplicity are both real: rendered fragments
and serialized responses in a fleet where per-byte cost and per-core throughput
decide the bill. In practice most designs are better served by Redis, because
sooner or later you want a counter, a sorted set or a TTL-scoped set, and running
one system beats running two.

> The valuable interview move is not choosing Memcached — it is being able to
> answer *"why Redis and not Memcached?"* in one sentence.
