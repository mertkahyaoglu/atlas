# Distributed Cache — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design a distributed cache. Think Redis or Memcached, but you're building it.

@you
Let me pin down what kind of cache, because Redis can be a database with a lot of features bolted on.

1. The interface is `get`, `set` with a TTL, and `delete`? Do we need rich data types, transactions?
2. When memory fills up, we evict — is the policy configurable?
3. Do we need to add and remove nodes while it's serving traffic?
4. Is it ever the source of truth, or always in front of a database?
5. Replication — for availability, for read scaling, or not at all?

@interviewer
Get, set, delete with TTLs. Configurable eviction. Yes, nodes come and go under load. It's always in front of a database. Replication is optional — your call.

@you
Then here's what I'm building, and what I'm not.

**Functional:** `get(key)`, `set(key, value, ttl)`, `delete(key)`; TTL expiry; configurable eviction when memory is full; **add and remove nodes without a full cache flush**; optional replication.

**Non-functional:** **p99 under 1ms for a hit.** Millions of operations a second across the cluster. And the two that matter most: the cache is **not the source of truth** — losing it must degrade *performance*, never *correctness* — and a node failure must not take down the application tier.

**Out of scope, deliberately:** durable persistence — I'll mention when it's worth turning on — complex data types, and transactions.

@interviewer
Numbers?

@you
Yes. There's one metric I want to anchor everything on.

@note · Playbook 10.1, phase 1
"Losing the cache degrades performance, never correctness" is the requirement that settles half the later questions — durability, replication, invalidation. And "nodes come and go under load" is the one that points straight at the hard part.

## Estimate · 3 min · Memory-bound, and hit rate is everything

@you
- **Operations:** 10M/sec across the cluster.
- **Hot working set:** ~1 TB.
- **Nodes:** ~100 at 16 GB each. That's 1.6 TB of RAM for 1 TB of data, which is deliberate headroom — fragmentation and per-entry overhead are real, and a 16 GB node doesn't hold 16 GB of values.
- **Keys:** ~1 KB average value, so **~1B keys**.
- **Per node:** 10M ÷ 100 is ~100k ops/sec — comfortable for a single-threaded in-memory node.

And the key metric: **hit rate.** At 95%, 5% of reads reach the database. At 80%, 20% do — **four times the origin load**, from a fifteen-point drop.

The conclusion: **the cluster is memory-bound, and hit rate is the number everything else serves.** So any decision that risks mass invalidation — like naive hashing when we resize — isn't a cache inefficiency. It's an **availability decision for the database behind it.**

@interviewer
You said single-threaded. Why?

@you
It's how Redis gets atomic operations with no locks — `INCR` is safe as a distributed counter because nothing else runs while it executes. The cost is that **one expensive command blocks every client on that node**. `KEYS *` on a big keyspace is an outage. So unbounded commands are banned in production, and we iterate with `SCAN` and a cursor instead.

@note · Playbook 10.1, phase 2
Doing the hit-rate arithmetic — 5% to 20% of reads is 4x the origin load — is what turns "hit rate matters" into a design constraint. Reframing mass invalidation as a *database* availability problem sets up the deep dive.

## API and data model · 5 min · A hash map, a linked list, and a ring

@you
Five commands:

- `GET key` → value or `NOT_FOUND`.
- `SET key value [EX ttl]` → `OK`.
- `DEL key` → count.
- `INCR key` → int — atomic, no read-modify-write race.
- `MGET k1 k2 k3` — batching cuts round trips, which matters when the budget is a millisecond.

@you · at the whiteboard
Per node, in memory, and cluster-wide:

| Structure | Shape | The point |
|---|---|---|
| `hash_map` | key → list node | O(1) lookup |
| LRU list | doubly linked, MRU ↔ LRU | O(1) reorder and evict |
| `entry` | `{key, value, expires_at, prev, next}` | |
| `ring` | hash position → physical node, via virtual nodes | routing |
| `membership` | node → `alive \| suspect \| dead` | gossip-propagated |

@interviewer
Sketch LRU for me.

@you
A hash map plus a doubly linked list. On `GET`, look up the entry in the map — O(1) — unlink it and move it to the head of the list — O(1), because it has `prev` and `next` pointers. On `SET` when memory is full, drop the tail — the least recently used — and remove it from the map. Everything is constant time.

Real systems approximate it, though. Redis **samples a handful of random keys and evicts the least recently used among them**, because exact LRU ordering costs two pointers per entry and a list update on every read. Approximate LRU is nearly as good and much cheaper — a nice case of accepting an approximation where exactness isn't worth its cost.

@interviewer
Why LRU and not LFU?

@you
LRU matches temporal locality, so it's the sensible default. **LFU** handles stable popularity better, but it suffers **cache pollution** — something hugely popular last month keeps a high count forever — so it needs aging. **TTL-only** is right when staleness, not memory, is the constraint. In practice most systems combine them: **LRU for eviction, TTL for correctness.**

@note · Playbook 10.1, phase 3
Being able to sketch LRU is table stakes; saying why production systems *don't* implement it exactly is the level above. "LRU for eviction, TTL for correctness" separates two concerns people tend to blur.

## High-level design · 10 min · Smart client, a ring, and nodes that know nothing about each other's data

@you · drawing
Let me trace a `GET user:1234`.

1. The application calls a **smart client library**, which holds its own copy of the **ring**.
2. It hashes `user:1234` and finds the **first node clockwise** from that position.
3. It connects **directly** to that node — no proxy hop.
4. The node looks up the key in its hash map and moves the entry to the head of its LRU list.
5. **Hit**: the value goes straight back.
6. **Miss**: the application reads the **origin database** and `SET`s the value back into the same node, so the next read hits.

Beside the request path: each node **streams writes asynchronously to a replica**, and **gossip** — SWIM-style — moves nodes through suspect, confirmed and dead before anyone changes the ring.

@interviewer
Why a smart client? A proxy would be simpler.

@you
It's a real trade-off:

| | Smart client | Proxy tier |
|---|---|---|
| Latency | 1 hop | 2 hops |
| Client complexity | high — ring logic in every language | thin clients |
| Config rollout | update every client | update proxies only |
| Failure isolation | a client bug is everywhere | a contained tier |

Smart clients win on latency, which is the entire point of a cache with a 1ms budget. Proxies win on operability — reimplementing ring logic in five languages is a liability. So: **single-language shop, smart client; large polyglot org, proxy.** For this design, I'll take the smart client.

@interviewer
Do you need the replicas?

@you
A pure cache doesn't — a lost node is just misses, and the origin repopulates. I'd add **async replicas** for two reasons: read scaling on hot nodes, and avoiding a cold-start stampede when a node dies, because a replica can be promoted warm. Async means a replica can serve a **slightly stale** value. For a cache that's usually fine, but I want to say it rather than gloss over it.

@interviewer
Should the cache be durable?

@you
Generally no. Durability costs write latency, and the data is reconstructible from the origin by definition. The one legitimate reason to turn on snapshots or an append-only log is **faster warm-up after a restart** — a node that comes back with most of its data doesn't stampede the database.

@note · Playbook 10.1, phase 4
When a trade-off really is two-sided, put it in a table and pick a side *conditionally* — "single-language shop, smart client". That's more credible than declaring one option always right.

## Deep dive · 15 min · Rebalancing, hot keys, and the miss path

@you
The canonical hard part is **rebalancing** — what happens when nodes come and go. The follow-up that catches people is **hot keys**, which consistent hashing doesn't solve. And the miss path has three distinct failure modes. I'd go in that order. OK?

@interviewer
Go.

@you
Start with why the naive approach fails. With `hash(key) % 4`, adding a fifth node changes every key's destination to `% 5`. Roughly **80% of keys** are suddenly on the wrong node. So 80% of requests miss, all at once, and all hit the database simultaneously. That's not a cache inefficiency — **it's a database outage**, caused by adding capacity.

**Consistent hashing** puts nodes and keys on the same ring. A key belongs to the first node clockwise. Add a node, and it takes over only the arc between itself and its counter-clockwise neighbour — **~1/N of keys, moving from one adjacent node.** Remove a node, and its arc goes to the next one clockwise. Equally surgical.

@interviewer
Isn't the distribution uneven with only a hundred nodes placed randomly?

@you
Very — which is why **virtual nodes aren't optional.** With a few physical nodes at random positions, the arcs between them vary enormously, and one node can own three times its fair share. Place each physical node at **~150 positions** and the randomness averages out to near-uniform.

Virtual nodes buy two more things. **Weighting**: a machine with twice the RAM gets twice the vnodes. And **smoother removal**: a departing node's load spreads across many neighbours instead of landing entirely on one.

@interviewer
When you add a node, what happens to the data that should now live there?

@you
Two options. **Lazy**: the new node starts empty, and misses repopulate it from the origin. Simple, but there's a temporary hit-rate dip on that ~1/N of keys. **Eager**: the neighbour **streams the affected key range** to the new node before the ring flips. Eager avoids the dip, and it's worth it exactly when the origin can't absorb the extra misses — which, given the hit-rate arithmetic, is often.

@interviewer
How do clients learn the ring changed?

@you
Gossip among the nodes plus clients that periodically refresh topology — or a configuration service clients watch. There's always a propagation window where some clients have a stale ring and send requests to the wrong node. Rather than fail those, the node answers with a **redirect** — like Redis Cluster's `MOVED` — and the client updates its ring.

@interviewer
A node is slow for a few seconds. Gossip marks it dead.

@you
And that's its own outage: a healthy node evicted from the ring causes a mass remap of its keys and an origin stampede — exactly what the ring was built to prevent. So: require **multiple independent probes** before declaring death, go through a **suspicion phase** that the node can refute, and **rate-limit ring changes**. A slow node is much cheaper than a false death.

@interviewer
Now — one key gets a million reads a second.

@you
This is the follow-up that catches people: **consistent hashing does not solve hot keys.** The ring distributes *keys* evenly. One key maps to one node by definition, no matter how many vnodes there are. Three mitigations:

- **Client-side L1 cache.** A tiny in-process cache for the hottest keys absorbs repeat reads before they leave the app server. It needs no cluster changes, so it's my first answer. The cost is that per-server copies can briefly diverge.
- **Key replication with a suffix.** Store the value under `key#0` through `key#9`, and clients read a random one. Read load spreads across ten nodes; writes must update all ten.
- **Dedicated nodes** for known-hot keys.

@you
Then the miss path, which has three distinct failure modes:

| Failure | What happens | Fix |
|---|---|---|
| **Stampede** | a hot key expires and a thousand concurrent misses hit the database | **request coalescing** — the first miss takes a lock, the rest wait for its result; or probabilistic early expiry; or stale-while-revalidate |
| **Penetration** | repeated requests for keys that exist nowhere, so the cache never helps | **cache the negative result** with a short TTL; a **Bloom filter** in front rejects definitely-absent keys |
| **Avalanche** | many keys expire at once, or the cluster restarts cold | **TTL jitter**, warm before serving, and a **circuit breaker** in front of the database so it degrades rather than collapses |

@interviewer
How do you invalidate on a database write?

@you
**Delete the key rather than writing the new value.** Two concurrent updates writing to the cache can land out of order and leave the *older* value cached indefinitely. Deleting is idempotent and forces a fresh read. And for correctness-critical invalidation, drive it from **change-data-capture** on the database, so every write invalidates — including writes from other services, or someone fixing a row by hand.

@note · Playbook 10.1, phase 5
"Consistent hashing doesn't solve hot keys" is the sentence that separates a memorized answer from an understood one. Naming all three miss-path failure modes with a fix each is a fast, high-value signal — and the false-positive-death answer shows you know the ring can cause the outage it prevents.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
At 10x, I'd expect **hot keys** and **memory** to bite first — more traffic concentrates on the same popular keys, and a bigger working set means more nodes and more ring churn.

At 100x — a billion ops a second, ~1,600 nodes, ~100k app hosts — several choices flip:

1. **Smart clients become a local sidecar proxy.** Every process dialling every node is tens of millions of connections, and ring logic in every language becomes the liability. A proxy on each host keeps a one-hop localhost path with pooled connections. The client-versus-proxy trade-off flips at this size.
2. **Pools by workload**, so one team's churn doesn't evict another's data.
3. **A gutter pool** for failed nodes: with that many nodes something is always down, and rehashing onto neighbours can cascade. Requests go to a small short-TTL pool, and the ring doesn't change until the node is confirmed gone.
4. **A config service owns the ring**, with gossip only reporting liveness, so a flapping node can't cause remaps back and forth.
5. **Automatic hot-key detection** at the sidecar.
6. **CDC-driven invalidation** everywhere, because hundreds of services can't be trusted to delete the right keys.

@interviewer
Multi-region?

@you
**Independent clusters per region**, each in front of a regional read replica. I would not replicate cache state across regions — cross-region latency defeats the purpose of a sub-millisecond cache, and invalidation becomes a distributed-consistency problem we don't need to have.

@you
What I'd monitor: **hit rate first**, because it's the leading indicator of origin load; evictions per second, which say memory is the constraint; memory utilization including fragmentation; p99 latency per node, so one slow node is visible; connection count; and replication lag where replicas exist. And `maxmemory` is always set explicitly with an eviction policy — the alternative failure mode is the OS OOM-killer terminating the node, which is far worse than evicting a few keys.

@you
To close: a smart client routing over a consistent-hash ring with ~150 virtual nodes per machine, so resizing moves ~1/N of keys instead of 80%. Each node is a hash map and an approximate LRU on a single thread. Hot keys get an L1 cache and suffix replication because the ring can't help them, and the miss path is protected against stampede, penetration and avalanche. Hit rate is the number everything serves, because the real customer of this design is the database behind it.

@note · Playbook 10.5
Saying *which* earlier trade-off flips at scale — client versus proxy — shows the choice was conditional all along. Ending on "the real customer is the database behind it" ties rebalancing, hot keys and the miss path to one purpose.
