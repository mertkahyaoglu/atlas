---
group: "tech"
order: 12
title: "API gateway"
role: "Edge tier"
summary: "The front door: TLS, routing, auth, rate limits and timeouts, in one place instead of every service."
tags: ["api-gateway", "rate-limiting", "security", "circuit-breaker", "observability"]
---

# API gateway

## Basics

An API gateway is a reverse proxy that every external request passes through
before reaching a service. It exists so that the cross-cutting concerns — the ones
every service would otherwise reimplement — live in one tier.

It is worth being precise about the neighbours, because interviewers notice when
the terms are used loosely:

- A **load balancer** distributes connections across instances. It is L4 (TCP) or L7 (HTTP) and it does not know what your API means.
- An **API gateway** is L7 and application-aware: it routes by path and method, validates tokens, applies per-client quotas, and shapes requests.
- A **service mesh** handles service-to-service traffic inside the cluster (east-west), with sidecars doing mTLS, retries and tracing. The gateway is north-south.

In a real diagram you have all three: DNS → load balancer → gateway tier →
services. The gateway is itself a horizontally scaled, stateless tier behind that
load balancer, which is the answer to "isn't it a single point of failure?"

## Key concepts and capabilities

**Authentication once, at the edge.** The gateway validates the JWT or session,
rejects what fails, and forwards a trusted identity header downstream. Services
stop each implementing token validation, and revocation has one place to live.
Fine-grained authorisation — *can this user edit this document* — stays in the
service, because only the service knows.

**Rate limiting and quotas.** Per API key, per user, per IP, per endpoint. The
counters live in Redis so the limit is global rather than per gateway instance.
This is the most common reason a gateway appears in a design, and it is the natural
place to hang the rate-limiter design from module 04.

**Timeouts, retries, circuit breaking.** A budget per route, retries with jitter on
idempotent methods only, and a breaker that stops calling a dependency that is
failing. Say "retries only on idempotent requests" — retrying a payment because it
timed out is how you charge someone twice.

**Request shaping.** Schema validation at the edge, header normalisation,
compression, and protocol translation — REST or GraphQL outside, gRPC inside.

**Routing and rollout.** Path- and header-based routing, API versioning, canary and
blue-green by sending 1% of traffic to a new version, and feature-flagged routes.

**The BFF pattern.** A backend-for-frontend is a gateway specialised per client —
one for mobile that returns a compact aggregated payload, one for web. It is the
answer when a mobile client would otherwise make eight calls to render a screen.

**Observability for free.** One place that sees every request: latency histograms,
error rates by route and client, and the trace id that gets propagated downstream.

## When to use it in an interview

Draw it in essentially every design with external clients, say in one sentence what
it does — "terminates TLS, validates the token, applies the per-user rate limit,
routes to the right service" — and move on. It is table stakes, not a talking point,
and lingering on it burns time you need elsewhere.

Give it real attention only when the problem is about the edge: rate limiting and
abuse, API keys and tiers for a public API, aggregating chatty calls for a mobile
client, or a migration where traffic must be shifted gradually between an old and
new implementation.

## What interviewers push on

- **Where does rate limit state live?** Redis, shared across gateway instances, with a Lua script for the atomic check-and-decrement. Per-instance counters silently let through N times your limit.
- **Isn't it a single point of failure?** It is a stateless tier of many instances behind a load balancer, across availability zones. Failure of one instance drops nothing.
- **What about the extra hop?** A millisecond or two. Worth it for one implementation of auth, limits and timeouts, and you should be able to say that plainly.
- **Business logic creep.** The gateway routes and protects; it does not know your domain. A gateway that starts joining data is a distributed monolith.
- **WebSockets and streaming.** Long-lived connections need the gateway to pass them through and the load balancer to handle sticky, long-lived connections — and deployments must drain rather than cut them.
- **Aggregation latency.** A BFF that fans out to six services is as slow as the slowest. Parallelise, set a per-call deadline, and degrade with partial results.
