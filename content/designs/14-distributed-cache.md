---
group: "design"
order: 14
title: "Distributed Cache"
summary: "Building Redis: a hundred nodes holding a terabyte of hot data with sub-millisecond reads."
hardPart: "Rebalancing. Naive modulo hashing invalidates eighty percent of the cache when you add a node and stampedes the origin. And consistent hashing does not solve hot keys."
tags: ["consistent-hashing", "caching", "redis", "replication"]
hardPartDetail: "**Rebalancing**. What happens when you add or remove a node? Naive `hash % N` invalidates ~80% of the cache and stampedes the origin database. This is the canonical consistent-hashing question, and the second probe is hot keys, which consistent hashing does *not* solve."
concepts:
  - "consistent hashing"
  - "virtual nodes"
  - "LRU eviction"
  - "replication"
  - "hot keys"
  - "cache stampede/penetration/avalanche"
  - "gossip/membership protocols"
  - "client-side vs proxy-based routing"
requirements:
  functional:
    - "`get(key)`, `set(key, value, ttl)`, `delete(key)`"
    - "TTL-based expiry"
    - "Configurable eviction when memory is full"
    - "Add/remove nodes without a full cache flush"
    - "Optional replication for read scaling and availability"
  nonFunctional:
    - "p99 under 1ms for a hit"
    - "Millions of ops/sec across the cluster"
    - "Cache is *not* the source of truth — losing it must degrade performance, never correctness"
    - "Node failure must not take down the application tier"
  outOfScope: "durable persistence (mention it's optional), complex data types, transactions."
scale:
  numbers: |-
    Ops:            10M/sec
    Dataset:        1 TB hot working set
    Nodes:          ~100 × 16 GB RAM
    Avg value:      ~1 KB → ~1B keys
    Key metric:     HIT RATE. A drop from 95% → 80% triples origin load.
  conclusion: "The cluster is memory-bound, and hit rate is the number everything else serves. Any design decision that risks mass invalidation (like naive hashing on resize) is therefore an availability decision for the *database behind it*, not just a cache inefficiency."
tradeoffs:
  - title: "Why consistent hashing, concretely"
    body: |-
      With `hash(key) % 4` and a fifth node added, every key's destination changes from `% 4` to `% 5` — roughly 80% of the cache is suddenly on the wrong node, so 80% of requests miss and hit the database simultaneously. That's not a cache inefficiency, it's a database outage. Consistent hashing bounds the disruption to ~1/N of keys, moving only from the single adjacent node clockwise. Removing a node is equally surgical.
  - title: "Virtual nodes are not optional"
    body: |-
      With, say, eight physical nodes placed randomly on the ring, the arcs between them vary enormously, so one node might own 3x its fair share. Placing each physical node at ~150 positions averages out the randomness and produces near-uniform distribution. They also enable weighting — a machine with twice the RAM gets twice the vnodes — and make removal smoother, since the departing node's load spreads across many neighbours instead of dumping entirely on one.
  - title: "Client-side routing vs a proxy — a real trade-off"
    body: |-
      | | Smart client | Proxy tier (twemproxy, Envoy) |
      |---|---|---|
      | Latency | 1 hop | 2 hops |
      | Client complexity | high (ring logic in every language) | thin clients |
      | Config rollout | must update every client | update proxies only |
      | Failure isolation | client bugs are everywhere | proxy is a contained tier |

      Smart clients win on latency, which is the entire point of a cache. Proxies win on operability, especially in polyglot environments where reimplementing ring logic in five languages is a liability. Say which you'd choose and why — for a single-language shop, smart client; for a large polyglot org, proxy.
  - title: "LRU implementation"
    body: |-
      Hash map plus doubly-linked list gives O(1) for both lookup and reordering: on access, unlink the node and move it to the head; on eviction, drop the tail. Worth being able to sketch, since it's a common coding question in its own right.

      Real systems approximate. Redis samples a handful of random keys and evicts the least recently used among them, because maintaining exact LRU ordering costs memory per entry and adds contention. Approximate LRU is nearly as good and much cheaper — a nice example of accepting an approximation where the cost of exactness isn't justified.
  - title: "Eviction policy choice"
    body: |-
      LRU is the sensible default (matches temporal locality). LFU handles stable popularity better but suffers cache pollution — something hugely popular last month keeps a high count forever — so it needs aging. TTL-only is right when staleness, not memory, is the binding constraint. Mention that most systems combine: LRU for eviction, TTL for correctness.
  - title: "Hot keys are NOT solved by consistent hashing"
    body: |-
      This is the follow-up that catches people. The ring distributes *keys* evenly; it cannot help when one single key receives a million requests per second. All that traffic maps to one node by definition. Mitigations:
      - **Client-side L1 cache** for the hottest keys — a tiny in-process cache absorbs repeat reads before they leave the app server. Cost: per-server copies can briefly diverge.
      - **Key replication with a suffix** — store the value under `key#0..#9` and have clients read a random one. Spreads read load across ten nodes; writes must update all ten.
      - **Dedicated nodes** for known-hot keys.

      Naming the L1 cache as the first-line answer is the practical one, since it requires no cluster changes.
  - title: "The three failure modes, with fixes"
    body: |-
      - **Stampede/thundering herd**: a hot key expires and a thousand concurrent misses hit the database at once. Fix with request coalescing (first miss takes a lock, others wait for its result), probabilistic early expiry, or stale-while-revalidate.
      - **Penetration**: repeated requests for keys that exist nowhere, so the cache never helps. Fix by caching the negative result with a short TTL, and/or a Bloom filter in front to reject definitely-absent keys.
      - **Avalanche**: many keys expire simultaneously (or the cluster restarts cold), dumping full load on the origin. Fix with TTL jitter, cache warming before serving traffic, and a circuit breaker in front of the database so it degrades instead of collapsing.

      Being able to name all three and give a fix each is a fast, high-value signal.
  - title: "Replication is optional and changes the guarantees"
    body: |-
      A pure cache needs no replication — a lost node means a miss, and the origin repopulates. Add async replicas when you want read scaling or to avoid a cold-start stampede after a node dies. Async replication means replicas can serve stale values; since this is a cache, that's usually fine, but say it rather than glossing over it.
  - title: "Cache invalidation"
    body: |-
      Prefer **deleting** a key over writing a new value into it. Two concurrent updates writing to the cache can land out of order and leave the older value cached indefinitely; deleting is idempotent and forces a fresh read. For correctness-critical invalidation, drive it from change-data-capture on the database so *every* write invalidates, including ones made by other services or by hand.
  - title: "Single-threaded execution"
    body: |-
      Redis executes commands on one thread, which is why `INCR` is atomic with no locking and why it's a safe distributed counter. The consequence: one expensive command (`KEYS *` on a large keyspace) blocks every other client. Never run unbounded commands in production — use `SCAN` with a cursor instead.
  - title: "Memory management"
    body: |-
      Fragmentation is real: a 16 GB node does not hold 16 GB of values. Use a slab allocator (Memcached's approach) or jemalloc with monitoring. Set `maxmemory` explicitly with an eviction policy, because the failure mode of not doing so is the OS OOM-killer terminating the node, which is far worse than evicting a few keys.
followUps:
  - question: "How do you migrate data when adding a node?"
    answer: "Two options. Lazy: the new node starts empty, misses repopulate from the origin — simple, but a temporary hit-rate dip. Eager: the neighbour streams the affected key range to the new node before the ring flips. Eager avoids the dip and is worth it when the origin can't absorb the extra misses."
  - question: "How do clients learn about ring changes?"
    answer: "Gossip among nodes plus a client that periodically refreshes topology, or a configuration service the clients watch. Staleness during propagation means some requests go to the wrong node — handle with a redirect response (like Redis Cluster's `MOVED`) rather than failing."
  - question: "How do you avoid a false-positive failure detection cascade?"
    answer: "Require multiple independent probes before declaring a node dead, use a suspicion phase, and rate-limit ring changes. Premature eviction of a healthy node causes an unnecessary mass remap, which is exactly the stampede you built the ring to avoid."
  - question: "Should this cache be durable?"
    answer: "Generally no — durability costs write latency and the data is reconstructible. Redis offers snapshots and an append-only log if you want faster warm-up after a restart, which is the main legitimate reason to enable it."
  - question: "Multi-region caching?"
    answer: "Independent clusters per region, each fronting a regional read replica. Don't replicate cache state across regions; cross-region latency defeats the purpose and invalidation becomes a distributed-consistency problem you don't need."
  - question: "What do you monitor?"
    answer: "Hit rate first (it's the leading indicator of origin load), then evictions per second, memory utilization, p99 latency, connection count, and replication lag if replicas exist."
---
# 14 — Distributed Cache (Design Redis/Memcached)

## API / Model

```api
@commands
GET key || || value | NOT_FOUND
SET key value [EX ttl] || || OK
DEL key || || count
INCR key || || int || atomic, no read-modify-write race
MGET k1 k2 k3 || || values || batching cuts round trips
```

```schema
# Per node · in memory
hash_map || || key → node in doubly-linked list || O(1) lookup
LRU list || || MRU ◄──►◄──►◄──► LRU || O(1) reorder and evict
entry || || {key, value, expires_at, prev, next} ||
# Cluster state
ring || || hash position → physical node, via virtual nodes ||
membership || || node → alive | suspect | dead || gossip-propagated
```

---

## High-level architecture

<!-- tab: Today · 10M ops/s -->

```mermaid
flowchart TB
    subgraph APP ["Application servers"]
        direction TB
        Client["SMART CLIENT library<br/>holds a copy of the ring<br/>hashes key → picks node → direct<br/>NO PROXY HOP = lowest latency<br/>optional tiny L1 for hot keys"]
    end
    HotKey["HOT KEYS are NOT solved by the ring<br/>one key = one node by definition<br/>fix: client-side L1, key replication<br/>with suffix, or dedicated nodes"] -.-> Client

    Client -- "hash('user:1234')" --> Ring
    Ring{{"CONSISTENT HASHING RING<br/>key → first node CLOCKWISE from its hash<br/>resize remaps only ~1/N keys, from ONE neighbour<br/>(naive hash % N remaps ~80% · CATASTROPHE)<br/>~150 VIRTUAL NODES per physical node<br/>smooth distribution · allow weighting"}}

    subgraph NODES ["Cache nodes"]
        direction LR
        N1["Node N<br/>hash map → LRU list<br/>O(1) get and evict<br/>single-threaded: atomic ops,<br/>no locks, but one slow<br/>command blocks everything"]
        N2["Node 2"]
        N3["Node 1"]
    end
    Ring --> N3 & N2 & N1
    Gossip["Membership · gossip / SWIM<br/>suspicion → confirmation → dead<br/>avoid false positives: premature<br/>eviction causes a needless remap<br/>and an origin stampede"] -.-> NODES

    N1 -. "async" .-> R1[("Replica N")]
    N2 -. "async" .-> R2[("Replica 2")]
    N3 -. "async" .-> R3[("Replica 1")]

    N1 -- "MISS" --> Origin[("Origin database")]
    Origin -- "SET back into cache" --> N1
    Origin -.- Failures["Failure modes at the miss path<br/>STAMPEDE · coalesce requests<br/>PENETRATION · cache negatives, Bloom filter<br/>AVALANCHE · TTL jitter, warm start,<br/>circuit breaker in front of origin"]

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Origin db
    class R1,R2,R3 cache
    class Ring,HotKey hot
```

There is no proxy tier: a smart client library inside each application server routes every request straight to a cache node. The origin database sits behind the nodes and is only read on a miss.

1. The application calls the smart client, which hashes the key, such as `user:1234`, against its own copy of the ring. Before that, it can answer the hottest keys from its optional tiny L1 cache.
2. On the consistent hashing ring, the key belongs to the first node clockwise from its hash. Every physical node sits at about 150 virtual node positions, so keys spread evenly and a resize remaps only about 1/N of them.
3. The client connects directly to that node, with no proxy hop in between.
4. The node finds the key in its hash map and moves the entry to the front of its LRU list, both in O(1). It runs commands on a single thread and evicts from the tail of the list when memory is full.
5. On a hit, the value goes straight back to the client.
6. On a MISS, the value is read from the origin database and SET back into the same node, so the next read for that key hits.

Two flows run beside the request path. Each node streams writes asynchronously to its own replica, and membership uses gossip in the SWIM style, moving a node through suspicion and confirmation before declaring it dead and changing the ring the clients use. The stampede, penetration and avalanche failure modes all surface at the miss path, as extra load on the origin database.

<!-- tab: At 100x · 1B ops/s -->

```mermaid
flowchart TB
    subgraph HOST ["Each application host · ~100k of them"]
        direction TB
        App[Application]
        L1["In-process L1<br/>auto-detected hot keys"]
        Sidecar["Local routing proxy · sidecar<br/>ring + pools + pooled connections<br/>one localhost hop"]
        App --> L1 --> Sidecar
    end
    Config[("Config service · ring authority<br/>rate-limited membership changes<br/>gossip only reports liveness")] -.-> Sidecar
    HotKeys["Hot key detector<br/>samples traffic at the sidecar<br/>spreads hot keys as suffixed copies"] -.-> L1

    Sidecar -- "pool chosen by key prefix" --> P1 & P2 & P3
    subgraph POOLS ["Cache pools by workload · ~800 primaries × 128 GB, plus replicas"]
        direction LR
        P1["Small hot keys"]
        P2["Large values"]
        P3["General"]
    end

    Sidecar -. "target node down:<br/>no rehash" .-> Gutter["Gutter pool<br/>takes a dead node's traffic<br/>short TTL · ring unchanged"]
    P3 -- "MISS" --> Warm["Warm-up path<br/>only while a cluster is cold:<br/>read a warm cluster first"]
    Warm --> Origin[("Origin database · per region")]
    Origin -- "replication stream" --> Invalidate["Invalidation daemon · per region<br/>deletes keys from DB changes"]
    Invalidate -.-> P1 & P2 & P3

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    classDef scaled stroke-dasharray:5 3
    class Origin,Config db
    class L1,P1,P2,P3,Gutter cache
    class Sidecar,Gutter hot
    class L1,Sidecar,Config,HotKeys,P1,P2,P3,Gutter,Warm,Invalidate scaled

    click L1 href "/docs/04-caching" "Role: a tiny in-process cache for keys the detector flags as hot.<br/>Trade-off: per-host copies can briefly disagree after a write."
    click Sidecar href "/docs/07-apis-and-communication" "Role: routes every request over one localhost hop and pools connections to the nodes.<br/>Trade-off: a process on every host to deploy and keep healthy."
    click Config href "/docs/03-consistency-and-distributed-systems" "Role: the authority for ring membership, applying changes at a limited rate.<br/>Trade-off: a dead node stays in the ring a little longer, which the gutter pool covers."
    click HotKeys href "/docs/04-caching" "Role: finds hot keys by sampling and spreads each across several nodes.<br/>Trade-off: a write to a hot key has to update every copy."
    click P1 href "/docs/04-caching" "Role: pools sized and tuned per workload, so eviction patterns don't collide.<br/>Trade-off: capacity is split, so one pool can be full while another has room."
    click Gutter href "/docs/08-reliability-and-operations" "Role: absorbs a failed node's traffic without remapping the ring.<br/>Trade-off: values served from the gutter can be a few seconds stale."
    click Warm href "/docs/08-reliability-and-operations" "Role: fills a cold cluster from a warm one before touching the database.<br/>Trade-off: the warm cluster carries extra read load during warm-up."
    click Invalidate href "/docs/03-consistency-and-distributed-systems" "Role: deletes cached keys from the database's own change stream, in every region.<br/>Trade-off: invalidation lags writes by the replication delay."
```

Same cache at 100x. A billion operations a second is the order of magnitude the largest social networks push through their cache tier. Dashed outlines mark what's new or reshaped compared with today's design.

| | Today | At 100x |
|---|---|---|
| Operations | 10M/sec | 1B/sec |
| Hot data set | 1 TB | 100 TB |
| Keys | ~1B | ~100B |
| Cache nodes | ~100 × 16 GB | ~800 primaries × 128 GB, plus replicas |
| Connections if every host dials every node | ~100k | ~80M |

**What changes, and the number that forces it**

1. **Smart clients give way to a local sidecar.** The smart client's advantage was one hop. At ~100k application hosts and ~800 nodes, every process dialing every node means ~80M connections, and every ring change has to reach client libraries in every language. A routing proxy on each host keeps the latency argument (one localhost hop, pooled connections to the nodes) while keeping ring logic in one place. This is the shape Meta's mcrouter took: the client-versus-proxy trade-off flips at this size.
2. **One cluster splits into pools by workload.** Tiny hot keys, large values and everything else behave very differently under eviction, and at 100 TB one team's churn evicts another team's data. The sidecar picks a pool by key prefix, and each pool is sized and tuned for its workload.
3. **A gutter pool catches failed nodes.** With ~1,600 nodes, something is always failing. Rehashing a dead node's keys onto its neighbours dumps its load on nodes that may then fail too. Instead, requests whose node is down go to a small gutter pool with short TTLs, and the ring doesn't change until the node is confirmed gone. Values served from the gutter can be a few seconds stale.
4. **The ring gets an authority.** Gossip across ~1,600 nodes converges slowly, and a flapping node triggers remaps back and forth. A config service owns ring membership and rate-limits changes, while gossip only feeds it liveness hints. This is the false-positive cascade follow-up, answered structurally.
5. **Hot keys are found automatically.** At 1B operations/sec some key is always hot, and nobody knows which one in advance. The sidecar samples traffic, flags keys over a threshold and spreads them across several nodes as suffixed copies; the hottest also land in each host's in-process L1.
6. **Invalidation comes from the database, per region.** With hundreds of services writing, the application can't be trusted to delete every affected key. A daemon in each region tails the database's replication stream and deletes keys from it: the change-data-capture answer from the invalidation trade-off, applied everywhere.
7. **New clusters warm from warm ones.** A cold cluster at this size would stampede its database. While cold, it reads misses from a warm cluster first and only then from the origin, until its hit rate catches up.

**What stays the same**

Consistent hashing with virtual nodes (now inside the sidecar), a cache that's never the source of truth, LRU plus TTL, the stampede, penetration and avalanche fixes, deleting keys rather than setting them on invalidation, and independent clusters per region. Hit rate is still the number everything else serves.

<!-- /tabs -->

---
