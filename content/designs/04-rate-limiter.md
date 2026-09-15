---
group: "design"
order: 4
title: "Distributed Rate Limiter"
summary: "One global limit enforced across a fleet of stateless API servers, at a million requests per second."
hardPart: "Enforcing a global limit without a synchronous Redis round trip on every request — and deciding what happens when the limiter's own store is down."
tags: ["rate-limiting", "redis", "concurrency", "reliability"]
hardPartDetail: "Enforcing one global limit across N stateless API servers without adding a synchronous Redis round trip to every single request — and knowing what happens when the limiter's own datastore is down."
concepts:
  - "token bucket / sliding window algorithms"
  - "distributed counters"
  - "Redis atomicity (Lua scripts)"
  - "latency-vs-accuracy trade"
  - "API gateway placement"
  - "429 semantics"
  - "graceful degradation"
requirements:
  functional:
    - "Limit requests per identity (user ID, API key, IP) over a time window"
    - "Support multiple tiers (free: 100/min, pro: 10,000/min)"
    - "Support per-endpoint limits (expensive endpoints get tighter caps)"
    - "Return 429 with `Retry-After` and remaining-quota headers"
    - "Rules configurable at runtime, no deploy"
  nonFunctional:
    - "Added latency < 5ms p99 — the limiter sits in front of *everything*"
    - "Must not become a single point of failure"
    - "Accurate enough: brief small overshoot acceptable, 10x overshoot not"
    - "Horizontally scalable with the API tier"
  outOfScope: "DDoS mitigation at L3/L4 (that's upstream, at the CDN/scrubbing layer), billing."
scale:
  numbers: |-
    1M requests/sec at the edge
    Identities tracked: ~50M active keys
    State per identity: ~50 bytes → 2.5 GB, fits comfortably in Redis memory
  conclusion: "State is small and hot. Redis is the obvious store; the design question is *how often you talk to it*."
tradeoffs:
  - title: "Algorithm choice — know all four, recommend one"
    body: |-
      ```
      FIXED WINDOW            limit 100/min
       [10:00:00─10:00:59] ████████████ 100
       [10:01:00─10:01:59] ████████████ 100
                          ▲
              100 at 10:00:59 + 100 at 10:01:00
              = 200 in one second. BOUNDARY BURST BUG.

      SLIDING WINDOW LOG      exact, stores every timestamp
       [t1 t2 t3 ... t100]  ← memory grows with traffic. Accurate but costly.

      SLIDING WINDOW COUNTER  the practical compromise
       count = curr + prev × (fraction of prev window still in view)
       ~exact, O(1) memory.

      TOKEN BUCKET            ← recommended default
         capacity B = 100 (burst), refill R = 10/sec
         ┌──────────────┐
         │ ● ● ● ●      │ ← refills at R
         └──────┬───────┘
                │ 1 token per request
                ▼  empty → reject
       Allows bursts up to B, enforces long-run average R.
       Real traffic IS bursty; idle clients should be allowed to catch up.
      ```

      **Why token bucket wins in most interviews:** it matches real traffic shape, needs only two numbers of state (`tokens`, `last_refill_ts`), and refill is computed lazily on access rather than by a background timer. Use **leaky bucket** instead only when the downstream genuinely cannot absorb bursts (a third-party API with a hard cap), because leaky bucket smooths output completely at the cost of queueing latency.
  - title: "Distributed state — the actual design decision"
    body: |-
      | Approach | Latency | Accuracy | Notes |
      |---|---|---|---|
      | Centralized Redis per request | +1-2ms | exact | Redis in the path of every request; a Redis blip is an outage |
      | Local counters, quota divided by N | 0ms | poor | Unfair under uneven load balancing; breaks when N autoscales |
      | **Two-tier (local + async sync)** | ~0ms typical | good | Recommended: local bucket absorbs the common case, syncs to Redis on a batch/threshold |
      | Gossip between gateways | 0ms | eventual | Complex, rarely worth it |

      **The two-tier answer in detail:** each gateway holds a local allowance and decrements it locally with zero network cost. It syncs with Redis every N requests or every X milliseconds, reconciling its local view with the global count. Overshoot is bounded by `(number of gateways × sync batch size)` — a number you can compute and state. This buys you near-zero added latency and removes Redis from the hot path, at the cost of small, bounded inaccuracy. For a 100/min limit, brief overshoot to 105 is fine. For a "1 free trial per account" limit, it is not — so use exact centralized checks for correctness-critical limits and two-tier for traffic-shaping limits. Making that distinction is the senior move.
  - title: "Why the Lua script matters"
    body: |-
      `GET` then `SET` is a read-modify-write race: two gateways both read 5 tokens, both decrement, both write 4, and two requests consumed one token. Redis executes Lua scripts atomically on its single thread, making check-and-decrement one indivisible operation and one round trip.
  - title: "Fail open or fail closed?"
    body: |-
      If Redis is down: failing **closed** rejects all traffic and turns a limiter outage into a total outage. Failing **open** lets traffic through unlimited and risks overwhelming backends. The usual answer is fail open on the local bucket — keep enforcing the per-gateway local limit so you're not completely unprotected, serve traffic, and alert loudly. State the choice and the reasoning; interviewers care more about the reasoning than the choice.
  - title: "Sharding Redis"
    body: |-
      Hash by identity, so all state for one key lives on one node and the Lua script is a single-node atomic operation. Cross-slot operations would break atomicity — a good detail.
  - title: "Hot keys"
    body: |-
      One enormous customer's key concentrates on one Redis shard. Either give large tenants dedicated shards, or shard their key into sub-buckets (`key#0..#9`, each with 1/10 the limit) and pick one at random per request.
  - title: "What to limit by, and the trap"
    body: |-
      Per user ID is fairest but requires authentication, so the *authentication* endpoint itself must be limited by IP. IP limiting is blunt: corporate NAT means thousands of users share an IP, and attackers rotate proxies. The realistic answer is layered limits — IP at the edge, API key at the gateway, user ID at the service, plus per-endpoint overrides for expensive operations.
followUps:
  - question: "A client ignores 429 and hammers you."
    answer: "Escalate: exponentially longer cooldowns, then temporary blocks at the CDN/WAF layer so the traffic never reaches your gateways."
  - question: "How do you support \"1,000 requests per day\" alongside \"10 per second\"?"
    answer: "Multiple buckets checked in sequence; deny if any denies. Return the most restrictive `Retry-After`."
  - question: "Rate limiting by cost, not count?"
    answer: "Assign a weight per endpoint and deduct that many tokens. Natural extension of token bucket, and how most real API quota systems work."
  - question: "How do you roll out a limit change safely?"
    answer: "Run in shadow mode first — evaluate the rule and log what *would* have been rejected, without rejecting. Then enable. This prevents accidentally cutting off a major customer."
  - question: "What do you monitor?"
    answer: "Rejection rate per tier (a spike means either an attack or a misconfigured limit), Redis latency p99, sync lag, and overshoot magnitude."
  - question: "Client-side rate limiting?"
    answer: "Useful and cheap (respect `Retry-After`, self-throttle) but never a substitute — you can't trust the client."
---
# 04 — Distributed Rate Limiter

## API / Model

```api
# Internal check · called by the gateway, not a public API
allow(identity, endpoint) || || {allowed: bool, remaining: int, reset_at: ts, retry_after: int}
# Rule configuration
PUT /admin/limits || {scope, identity_tier, endpoint_pattern, limit, window_sec, burst} || 200
# Over the limit
429 Too Many Requests || || || sent with the X-RateLimit-* and Retry-After headers
```

```schema
# Redis keys
rl:{identity}:{endpoint}:{window} || || counter or token-bucket state || TTL = window length, so keys clean themselves up; no GC job needed
# Rules · config service, cached locally with 30s refresh
tier || || {limit, window, burst, endpoint_overrides{}} ||
# Response headers
X-RateLimit-Limit || || requests allowed per window ||
X-RateLimit-Remaining || || requests left in the current window ||
X-RateLimit-Reset || || when the window resets ||
Retry-After || || 30 || seconds to wait before retrying
```

TTL-based expiry is worth pointing out: the counters garbage-collect themselves, so there's no cleanup job and memory is bounded by *active* identities, not total identities.

---

## High-level architecture

<!-- tab: Today · 1M req/s -->

```mermaid
flowchart TB
    Clients([Clients]) --> Scrub["CDN · L3/L4 scrubbing<br/>volumetric attacks die here"]
    Scrub --> LB[Load balancer]

    subgraph GATEWAYS ["API gateway fleet"]
        direction LR
        G3["Gateway 1<br/>L1 local bucket"]
        G2["Gateway 2<br/>L1 local bucket"]
        G1["Gateway N<br/>L1 local bucket"]
    end
    LB --> G1 & G2 & G3
    Config[("Config service · rules<br/>cached locally<br/>safe defaults on failure")] -.-> G1 & G2 & G3

    G1 -- "L2 · batched sync" --> Redis
    G2 -- "L2 · batched sync" --> Redis
    G3 -- "L2 · batched sync" --> Redis
    Redis[("Redis cluster · sharded by identity<br/>Lua script = atomic<br/>check-and-decrement<br/>one round trip, no race")]

    Redis --> Verdict{"tokens available?"}
    Verdict -- "allow" --> Backend[Backend services]
    Verdict -- "deny" --> Reject["429 Too Many Requests<br/>Retry-After · X-RateLimit-*"]
    Redis -. "unreachable → FAIL OPEN<br/>on local bucket only,<br/>log and alert" .-> Backend

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef external fill:#2f5a4d,stroke:#5cc98f,color:#d7dee8
    classDef gateway fill:#22565e,stroke:#38bdc1,color:#d7dee8
    classDef lb fill:#5d3759,stroke:#e066b2,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Config db
    class Redis cache
    class Verdict hot
    class Scrub external
    class G1,G2,G3 gateway
    class LB lb

    click Scrub href "/docs/04-caching" "Role: drops volumetric attacks before they reach your infrastructure.<br/>Trade-off: coarse filtering only, so per-user limits still happen further in."
    click Redis href "/docs/04-caching" "Role: the shared counter every gateway checks, atomically through one Lua script.<br/>Trade-off: a network hop on every request, and if it fails you must pick fail-open or fail-closed."
```

Limits are enforced in two layers inside the API gateway fleet: an L1 local bucket in every gateway, and a Redis cluster that holds the shared count. Volumetric attacks are dropped before traffic reaches either layer.

1. Client traffic first passes CDN L3/L4 scrubbing, and the Load balancer spreads what is left across the gateways.
2. The gateway finds the rule for the caller's identity and endpoint in its local copy of the Config service rules.
3. It checks the caller's L1 local bucket in memory, with no network call.
4. Every N requests or X milliseconds, the L2 batched sync reconciles that bucket with the Redis cluster, which is sharded by identity. A Lua script there runs the check-and-decrement atomically in one round trip, so every gateway works from the same global count.
5. If the bucket, as of its last sync, has a token, the request is allowed and goes to Backend services. If not, the gateway returns 429 Too Many Requests with `Retry-After` and the `X-RateLimit-*` headers.

Two flows run beside the request path. The Config service distributes rule changes to the gateways, which cache them and fall back to safe defaults when it is unreachable, so a limit can change without a deploy. The dotted edge from Redis to Backend services is the failure path: when Redis is unreachable, gateways keep enforcing their local buckets, let traffic through, and log and alert.

<!-- tab: At 100x · 100M req/s -->

```mermaid
flowchart TB
    Clients([Clients worldwide]) --> Scrub

    subgraph POP ["Edge PoP · ~300 locations"]
        direction TB
        Scrub["L3/L4 scrubbing + WAF"]
        EdgeLimit["Edge limiter<br/>per-IP buckets, local state only<br/>floods rejected where they land"]
        Scrub --> EdgeLimit
    end

    EdgeLimit --> LB["Regional LB<br/>nearest of ~20 regions"]
    LB --> Sketch

    subgraph GATEWAYS ["API gateway fleet · per region"]
        direction TB
        Sketch["Heavy-hitter sketch<br/>count-min per gateway<br/>most keys never near a limit"]
        Local["L1 local bucket<br/>only for keys above ~50% of limit"]
        Sketch -- "promote heavy hitters" --> Local
    end

    Local -- "L2 · batched sync" --> Redis[("Redis cluster · per region<br/>sharded by identity · Lua atomic<br/>biggest tenants on own shards")]
    Quota[("Global quota service<br/>leases each region a share<br/>of every global limit")] -- "rebalance every few sec" --> Redis

    Redis --> Verdict{"tokens available?"}
    Verdict -- "allow" --> Backend[Backend services]
    Verdict -- "deny" --> Reject["429 Too Many Requests<br/>Retry-After · X-RateLimit-*"]
    Redis -. "unreachable → FAIL OPEN<br/>on local bucket only" .-> Backend

    Config[("Rule sets · versioned<br/>pushed to PoPs and gateways<br/>shadow mode, then region by region")] -.-> EdgeLimit & Sketch

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef external fill:#2f5a4d,stroke:#5cc98f,color:#d7dee8
    classDef gateway fill:#22565e,stroke:#38bdc1,color:#d7dee8
    classDef lb fill:#5d3759,stroke:#e066b2,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    classDef scaled stroke-dasharray:5 3
    class Config,Quota db
    class Redis cache
    class Scrub,EdgeLimit external
    class Sketch,Local gateway
    class LB lb
    class Quota hot
    class EdgeLimit,LB,Sketch,Local,Redis,Quota,Config scaled

    click EdgeLimit href "/docs/08-reliability-and-operations" "Role: per-IP buckets in each CDN PoP, rejecting floods and scrapers where they land.<br/>Trade-off: local state only, so an attack spread thinly across PoPs is caught further in."
    click Sketch href "/docs/09-specialized-building-blocks" "Role: a count-min sketch per gateway that spots the keys approaching their limits.<br/>Trade-off: approximate, so a key that bursts inside one window slips through briefly."
    click Local href "/docs/07-apis-and-communication" "Role: real token buckets, only for keys the sketch flags.<br/>Trade-off: a newly promoted key is enforced with less history at first."
    click Redis href "/docs/04-caching" "Role: shared counts per region, sharded by identity with atomic Lua checks.<br/>Trade-off: global limits are only as exact as the quota leases allow."
    click Quota href "/docs/03-consistency-and-distributed-systems" "Role: splits each global limit into regional shares, rebalanced by demand every few seconds.<br/>Trade-off: overshoot is bounded by regions × lease slack, not zero."
    click Config href "/docs/08-reliability-and-operations" "Role: versioned rule sets pushed everywhere and rolled out gradually.<br/>Trade-off: a push pipeline to run, in exchange for no polling storm and a clean rollback."
```

Same limiter at 100x the traffic, which is roughly what the largest edge networks see. Dashed outlines mark what's new or reshaped compared with today's design.

| | Today | At 100x |
|---|---|---|
| Requests | 1M/sec | 100M/sec |
| Active identities | ~50M | ~1B |
| Bucket state if every key had one | ~2.5 GB | ~50 GB |
| Redis syncs, one per ~100 requests | ~10k/sec | ~1M/sec |
| Where traffic lands | a few regions | ~300 edge PoPs, ~20 regions |

**What changes, and the number that forces it**

1. **Per-IP limits move to the edge.** At 100M requests/sec a large share of traffic is abusive, and hauling it to a region just to reject it pays for bandwidth and gateway capacity twice. Coarse per-IP buckets run in the CDN's edge PoPs with local state only, so floods and scrapers are rejected where they land. Per-key and per-user limits stay in the regions, where identity is known.
2. **Most keys stop getting a bucket.** Of ~1B active identities, the vast majority never come near their limit, yet each bucket would cost memory and a stream of Redis syncs. Each gateway runs a count-min sketch to spot heavy hitters, and only keys above ~50% of their limit get a real token bucket and join the sync. Sync volume now tracks the keys that matter, not all of them. A key that jumps from idle to over-limit inside one sketch window slips through briefly, which the bounded-overshoot contract already allows.
3. **Redis goes regional, and global limits become leases.** One Redis for a global limit would put a cross-region round trip in every sync. Each region runs its own cluster, and a global quota service leases each region a share of every global limit, rebalanced every few seconds by observed demand. Overshoot is bounded by `regions × lease slack`, a number you can still compute and state. Correctness-critical limits ("one free trial per account") stay exact by checking one home region synchronously.
4. **The biggest tenants get their own shards.** At 100x, a single large customer sends more traffic than whole regions did before. Their keys live on dedicated Redis shards (or sub-buckets `key#0..#N`), so one tenant's burst can't raise latency for everyone sharing a shard.
5. **Rules are pushed as versions, not polled.** 30-second polling from ~300 PoPs and thousands of gateways is a load pattern of its own, and a bad rule would reach everywhere at once. Rule sets become versioned artifacts, pushed through the same channel as edge config, run in shadow mode, then rolled out region by region.

**What stays the same**

Token bucket as the default algorithm, Lua scripts for atomic check-and-decrement, identity-sharded Redis, fail open on local buckets while alerting, 429 with `Retry-After`, and layered limits: IP at the edge, API key at the gateway, user at the service. What changes is where each layer runs and how much state it bothers to keep.

<!-- /tabs -->

---
