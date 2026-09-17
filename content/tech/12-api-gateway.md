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
capabilities:
  - title: "Know the neighbours"
    body: |-
      A **load balancer** distributes connections across instances; it is L4 or L7 and does not know what your API means. An **API gateway** is application-aware: it routes by path and method, validates tokens, applies per-client quotas. A **service mesh** handles service-to-service traffic inside the cluster, with sidecars doing mTLS, retries and tracing.

      A real diagram has all three: DNS → load balancer → gateway tier → services.
  - title: "Authentication once, at the edge"
    body: |-
      The gateway validates the JWT or session, rejects what fails, and forwards a trusted identity header downstream. Services stop each implementing token validation, and revocation has one place to live.

      Fine-grained authorisation — *can this user edit this document* — stays in the service, because only the service knows.
  - title: "Rate limiting and quotas"
    body: |-
      Per API key, per user, per IP, per endpoint. The counters live in Redis so the limit is global rather than per instance.

      This is the most common reason a gateway appears in a design.
  - title: "Timeouts, retries, circuit breaking"
    body: |-
      A budget per route, retries with jitter on idempotent methods only, and a breaker that stops calling a dependency that is failing.

      Say "retries only on idempotent requests" — retrying a payment because it timed out is how you charge someone twice.
  - title: "Routing, rollout and the BFF"
    body: |-
      Path- and header-based routing, API versioning, canary and blue-green by sending 1% of traffic to a new version.

      A **backend-for-frontend** is a gateway specialised per client — one for mobile returning a compact aggregated payload, one for web. It is the answer when a mobile client would otherwise make eight calls to render a screen.
  - title: "Observability for free"
    body: |-
      One place sees every request: latency histograms, error rates by route and client, and the trace id propagated downstream.
useWhen:
  - "Any design with external clients — one sentence, then move on: it is table stakes, not a talking point"
  - "The problem *is* the edge: rate limiting and abuse, API keys and tiers for a public API"
  - "A mobile client needs eight calls aggregated into one (the BFF)"
  - "A migration has to shift traffic gradually between an old and a new implementation"
avoidWhen:
  - "It would hold business logic — a gateway that joins data is a distributed monolith"
  - "The traffic is service-to-service: that is a mesh, not the front door"
  - "You are tempted to spend interview minutes on it; the time belongs elsewhere"
probes:
  - question: "Where does the rate limit state live?"
    answer: "Redis, shared across gateway instances, with a Lua script for the atomic check-and-decrement. Per-instance counters silently let through N times your limit."
  - question: "Isn't the gateway a single point of failure?"
    answer: "It is a stateless tier of many instances behind a load balancer, spread across availability zones. Losing one instance drops nothing."
  - question: "What does the extra hop cost?"
    answer: "A millisecond or two, in exchange for one implementation of auth, limits and timeouts. Say that plainly rather than defending it."
  - question: "The gateway now needs data from two services to answer."
    answer: "That is the BFF pattern at best, and business logic creep at worst. Fan out in parallel with a per-call deadline, and degrade with partial results."
  - question: "How do WebSockets pass through it?"
    answer: "The gateway proxies the upgrade and the load balancer must handle long-lived, sticky connections — and deployments have to drain rather than cut them."
---

# API gateway

## How it works

An API gateway is a reverse proxy that every external request passes through
before reaching a service. It exists so that the cross-cutting concerns — the ones
every service would otherwise reimplement — live in one tier.

```mermaid
flowchart TB
    Client([Clients]) --> LB["Load balancer<br/>L4/L7 · no idea what your API means"]
    LB --> GW["API gateway tier<br/>stateless · many instances"]

    subgraph EDGE ["What it does, in order"]
        direction TB
        TLS["1 · terminate TLS"]
        Auth["2 · validate token<br/>forward trusted identity"]
        Limit["3 · rate limit<br/>Redis counters, global"]
        Route["4 · route, shape, set a deadline"]
        TLS --> Auth --> Limit --> Route
    end

    GW --> TLS
    Limit -.-> Redis{{"Redis<br/>shared counters"}}
    Route --> S1["Orders service"]
    Route --> S2["Search service"]
    S1 -. "service mesh<br/>mTLS · retries · tracing" .-> S2

    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Redis queue
    class Limit hot
```

The gateway is itself a horizontally scaled, stateless tier behind that load
balancer, which is the answer to "isn't it a single point of failure?"

## Where it fits in a design

Draw it, say in one sentence what it does — *terminates TLS, validates the token,
applies the per-user rate limit, routes to the right service* — and move on. Give
it real attention only when the problem is about the edge itself.

> The gateway routes and protects; it does not know your domain. That line is
> what keeps it from becoming the system.
