---
group: "tech"
order: 12
title: "API gateway"
role: "Edge tier"
summary: "The front door: TLS, routing, auth, rate limits and timeouts, in one place instead of every service."
tags: ["api-gateway", "rate-limiting", "security", "circuit-breaker", "observability"]
facts:
  - label: "What it is"
    value: "An L7 reverse proxy every external request passes through"
  - label: "Owns"
    value: "TLS, routing, token validation, quotas, timeouts, retries"
  - label: "Does not own"
    value: "Your domain: fine-grained authorisation stays in the service"
  - label: "Shape"
    value: "A stateless tier of many instances behind a load balancer"
  - label: "Direction"
    value: "North-south. East-west traffic is a service mesh's job"
  - label: "Cost"
    value: "One extra hop, a millisecond or two"
concepts:
  - "**Know the neighbours** — a load balancer spreads connections, a gateway understands the API, a mesh handles east-west"
  - "**Authenticate once** — validate the token at the edge and forward a trusted identity header downstream"
  - "**Authorise in the service** — whether *this* user may edit *that* document is domain knowledge the gateway lacks"
  - "**Rate limits live in Redis**, not in each instance, or you let through N times your limit"
  - "**Timeouts and budgets per route**, retries with jitter on idempotent methods only, and a breaker on failing dependencies"
  - "**Routing and rollout** — path and header routing, versioning, canary by sending 1% of traffic"
  - "**The BFF** — a gateway per client shape, so mobile gets one aggregated payload instead of eight calls"
  - "**Observability for free** — one place sees every request, its latency, its error rate and its trace id"
  - "**Keep logic out** — a gateway that starts joining data has become a distributed monolith"
---

# API gateway

## Use cases

### One front door for every request

Cross-cutting concerns live in one tier instead of being reimplemented in each
service: terminate TLS, validate the token, apply the quota, set a deadline,
route. In an interview this is one sentence and a box — it is table stakes, not a
talking point.

```mermaid
flowchart TB
    Client([Clients]) --> LB["Load balancer<br/>L4/L7 · connection spreading"]
    LB --> GW["API gateway tier<br/>stateless · many instances"]

    subgraph EDGE ["In order, per request"]
        direction TB
        TLS["1 · terminate TLS"]
        Auth["2 · validate token<br/>forward trusted identity"]
        Limit["3 · rate limit"]
        Route["4 · route + deadline"]
        TLS --> Auth --> Limit --> Route
    end

    GW --> TLS
    Route --> S1["Orders service"]
    Route --> S2["Search service"]

    classDef hot stroke:#e8a33d,stroke-width:2px
    class Limit hot
```

### A rate limit that counts every instance

Per-instance counters silently let through N times your limit, because each
gateway only sees its own share of traffic. The bucket lives in Redis and the
check-and-decrement is one Lua script, so the limit is global and atomic.

```mermaid
flowchart TB
    R([Requests]) --> G1["Gateway 1"]
    R --> G2["Gateway 2"]
    R --> G3["Gateway 3"]
    G1 -- "EVAL token_bucket<br/>one atomic step" --> Redis{{"Redis<br/>rl:{key}:{route}"}}
    G2 --> Redis
    G3 --> Redis
    Redis -- "allowed · remaining" --> G1
    Redis -. "empty bucket → 429<br/>+ Retry-After" .-> G2

    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Redis queue
    class Redis hot
```

### One call instead of eight, for mobile

A backend-for-frontend is a gateway specialised per client: it fans out in
parallel, sets a deadline per call, and returns a compact payload shaped for one
screen. The trap is latency — a BFF is as slow as its slowest dependency unless
it degrades.

```mermaid
flowchart TB
    Mobile([Mobile app]) -- "GET /home" --> BFF["Mobile BFF<br/>deadline 250 ms"]
    BFF -- "parallel" --> S1["Profile"]
    BFF --> S2["Feed"]
    BFF --> S3["Notifications"]
    S1 --> BFF
    S2 --> BFF
    S3 -. "slow → drop it, ship partial" .-> BFF
    BFF -- "one compact payload" --> Mobile

    classDef hot stroke:#e8a33d,stroke-width:2px
    class BFF hot
```

### Shifting traffic to a new version

Header- and weight-based routing is how a migration happens without a flag day:
1% of traffic to the new implementation, watch its error rate and latency at the
gateway (which already sees every request), then move the dial.

```mermaid
flowchart TB
    Traffic([All traffic]) --> GW["Gateway<br/>weighted routing"]
    GW -- "99%" --> Old["orders-v1"]
    GW -- "1% canary" --> New["orders-v2"]
    GW --> Metrics["Per-route error rate<br/>and latency, at the edge"]
    Metrics -. "canary worse → weight back to 0" .-> GW
    Metrics -. "canary healthy → 10%, 50%, 100%" .-> GW

    classDef hot stroke:#e8a33d,stroke-width:2px
    class GW hot
```
