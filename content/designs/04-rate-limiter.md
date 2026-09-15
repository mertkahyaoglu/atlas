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

    classDef store fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef external fill:#2f5a4d,stroke:#5cc98f,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Redis,Config store
    class Verdict hot
    class Scrub external

    click Scrub href "/docs/04-caching" "Role: drops volumetric attacks before they reach your infrastructure.<br/>Trade-off: coarse filtering only, so per-user limits still happen further in."
    click Redis href "/docs/04-caching" "Role: the shared counter every gateway checks, atomically through one Lua script.<br/>Trade-off: a network hop on every request, and if it fails you must pick fail-open or fail-closed."
```

<details>
<summary>Plain-text version of this diagram</summary>

```text
                        ┌────────────────────────────┐
  [Clients] ──────────► │  CDN / L3-L4 DDoS scrubbing │ (volumetric attacks die here)
                        └─────────────┬──────────────┘
                                       ▼
                        ┌────────────────────────────┐
                        │      Load Balancer          │
                        └─────────────┬──────────────┘
          ┌────────────────────────────┼────────────────────────────┐
          ▼                            ▼                            ▼
  ┌───────────────┐            ┌───────────────┐            ┌───────────────┐
  │ API GATEWAY 1 │            │ API GATEWAY 2 │            │ API GATEWAY N │
  │               │            │               │            │               │
  │ ┌───────────┐ │            │ ┌───────────┐ │            │ ┌───────────┐ │
  │ │ L1: local │ │            │ │ L1: local │ │            │ │ L1: local │ │
  │ │ in-memory │ │            │ │ in-memory │ │            │ │ in-memory │ │
  │ │ bucket    │ │            │ │ bucket    │ │            │ │ bucket    │ │
  │ │ (fast     │ │            │ │           │ │            │ │           │ │
  │ │  path)    │ │            │ │           │ │            │ │           │ │
  │ └─────┬─────┘ │            │ └─────┬─────┘ │            │ └─────┬─────┘ │
  └───────┼───────┘            └───────┼───────┘            └───────┼───────┘
          │                            │                            │
          │  L2: sync to shared state (batched / on threshold)      │
          └────────────┬───────────────┴────────────┬───────────────┘
                       ▼                            ▼
          ┌──────────────────────────────────────────────────┐
          │       REDIS CLUSTER (sharded by identity hash)     │
          │                                                    │
          │   Lua script = ATOMIC check-and-decrement          │
          │   ┌──────────────────────────────────────────┐    │
          │   │ local tokens = redis.call(GET, key)       │    │
          │   │ refill based on elapsed time              │    │
          │   │ if tokens >= 1 then                       │    │
          │   │    decrement; return ALLOW                │    │
          │   │ else return DENY, retry_after             │    │
          │   └──────────────────────────────────────────┘    │
          │   (single round trip, no read-modify-write race)   │
          └────────────────────┬─────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
              ALLOW │                      │ DENY
                    ▼                      ▼
        ┌──────────────────┐     ┌───────────────────────┐
        │ forward to        │     │  429 Too Many Requests │
        │ backend services  │     │  Retry-After: 30       │
        └──────────────────┘     │  X-RateLimit-*         │
                                  └───────────────────────┘

                  ┌────────────────────────────────────┐
                  │  CONFIG SERVICE (rules)             │
                  │  pushed/polled to gateways, cached  │
                  │  locally w/ safe defaults on failure│
                  └────────────────────────────────────┘

        ══ FAILURE MODE ══
        Redis unreachable → FAIL OPEN on local bucket only
        (serve traffic, log, alert) — protecting availability
        over perfect enforcement. State this choice explicitly.
```

</details>

Limits are enforced in two layers inside the API gateway fleet: an L1 local bucket in every gateway, and a Redis cluster that holds the shared count. Volumetric attacks are dropped before traffic reaches either layer.

1. Client traffic first passes CDN L3/L4 scrubbing, and the Load balancer spreads what is left across the gateways.
2. The gateway finds the rule for the caller's identity and endpoint in its local copy of the Config service rules.
3. It checks the caller's L1 local bucket in memory, with no network call.
4. Every N requests or X milliseconds, the L2 batched sync reconciles that bucket with the Redis cluster, which is sharded by identity. A Lua script there runs the check-and-decrement atomically in one round trip, so every gateway works from the same global count.
5. If the bucket, as of its last sync, has a token, the request is allowed and goes to Backend services. If not, the gateway returns 429 Too Many Requests with `Retry-After` and the `X-RateLimit-*` headers.

Two flows run beside the request path. The Config service distributes rule changes to the gateways, which cache them and fall back to safe defaults when it is unreachable, so a limit can change without a deploy. The dotted edge from Redis to Backend services is the failure path: when Redis is unreachable, gateways keep enforcing their local buckets, let traffic through, and log and alert.

---
