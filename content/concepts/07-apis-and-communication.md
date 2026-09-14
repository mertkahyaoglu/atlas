---
group: "concept"
order: 7
title: "APIs and Real-Time Communication"
summary: "REST, gRPC and GraphQL compared; polling through WebSockets; cursor pagination; API gateways; and four rate limiting algorithms."
tags: ["realtime", "websockets", "pagination", "rate-limiting", "grpc"]
---

# Module 7: APIs, Protocols, and Real-Time Communication

How components talk to each other, and how you control that traffic.

---

## 7.1 REST, gRPC, GraphQL

### REST

Resources identified by URLs, manipulated with HTTP verbs.

```
  GET    /users/123          fetch
  POST   /users              create
  PUT    /users/123          replace
  PATCH  /users/123          partial update
  DELETE /users/123          delete
```

Properties worth naming: it's stateless (each request carries its own auth and context), it uses HTTP semantics so caches and proxies understand it for free, and `GET`/`PUT`/`DELETE` are idempotent by specification while `POST` is not.

Strengths: universal tooling, cacheable, simple, human-debuggable. Weaknesses: **over-fetching** (the endpoint returns fields you don't need) and **under-fetching** (you need three round trips to assemble one screen).

### gRPC

Binary RPC over HTTP/2 using Protocol Buffers for serialization and a `.proto` file as a strict contract.

Strengths: much smaller payloads and faster serialization than JSON; HTTP/2 multiplexing means many concurrent calls on one connection; generated client code in every language; native bidirectional streaming; the schema is enforced rather than documented.

Weaknesses: not human-readable on the wire; limited browser support without a proxy layer; harder to debug with curl.

**The standard recommendation:** gRPC for internal service-to-service traffic where you control both ends and care about latency and throughput; REST (or GraphQL) at the public edge where clients are diverse.

### GraphQL

A single endpoint where the client specifies exactly what it wants.

```
  query {
    user(id: 123) {
      name
      posts(last: 5) { title, commentCount }
    }
  }
```

Strengths: solves over- and under-fetching precisely; excellent for mobile clients on poor networks; one round trip for a complex screen; clients evolve without backend changes.

Weaknesses that you should raise yourself: HTTP caching largely doesn't work (everything is a POST to one URL), a malicious or careless query can be arbitrarily expensive so you need query depth/complexity limits, and the **N+1 problem** is severe — a query for 100 users each with posts naively triggers 101 database queries. The standard fix is **DataLoader**-style batching, which collects the individual lookups within a request tick and issues one batched query.

---

## 7.2 Real-time communication

You need the server to push data to the client. Four options, in increasing capability.

### Short polling

The client asks "anything new?" every N seconds.

```
  Client ──?──► Server  (no)
   wait 5s
  Client ──?──► Server  (no)
   wait 5s
  Client ──?──► Server  (yes! here it is)
```

Simple and works everywhere. Wasteful: most requests return nothing, and latency is up to the polling interval. Fine for low-frequency updates where seconds of delay don't matter.

### Long polling

The client makes a request and the *server holds it open* until there's data (or a timeout), then responds. The client immediately re-requests.

```
  Client ──?──► Server  ......held open......  ──data──►
  Client ──?──► Server  ......held open......
```

Near-real-time latency without a new protocol. Costs a held connection per client and awkward server resource management. It was the standard pre-WebSocket solution and is still a reasonable fallback.

### Server-Sent Events (SSE)

A single long-lived HTTP connection over which the server streams events. **Unidirectional** (server to client only).

Strengths: plain HTTP, so it works through proxies and firewalls; automatic reconnection with a built-in `Last-Event-ID` mechanism for resuming; simple to implement. Weaknesses: server-to-client only; historically limited connections per domain on HTTP/1.1.

**Use SSE when updates flow one way**: notification feeds, live scores, progress bars, streaming LLM responses. It is underrated and choosing it correctly (rather than reflexively reaching for WebSockets) is a good signal.

### WebSockets

A persistent, **bidirectional** TCP connection established by upgrading an HTTP request.

Strengths: full duplex, very low latency, low per-message overhead after the handshake. Weaknesses: it's a stateful connection, which breaks the "stateless app tier" ideal from Module 1; load balancers and proxies need explicit support; you must implement your own reconnection, heartbeats, and message ordering/replay logic; each connection consumes server memory.

**Use WebSockets when the client also sends frequently**: chat, collaborative editing, multiplayer games, trading interfaces.

### The comparison

| | Short poll | Long poll | SSE | WebSocket |
|---|---|---|---|---|
| Direction | client pull | client pull | server → client | bidirectional |
| Latency | up to interval | near-real-time | near-real-time | lowest |
| Protocol | HTTP | HTTP | HTTP | ws:// (upgraded) |
| Auto-reconnect | n/a | manual | built in | manual |
| Server cost | low per conn, high total | held connections | held connections | held connections |
| Good for | infrequent updates | legacy fallback | feeds, streams | chat, games, collab |

### Scaling a WebSocket tier

This comes up whenever you propose WebSockets, so have the answer ready:

```
  Users connect to whichever gateway node the LB picks.

  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │Gateway 1 │  │Gateway 2 │  │Gateway 3 │
  │ Alice    │  │ Bob      │  │ Carol    │
  └────▲─────┘  └────▲─────┘  └────▲─────┘
       └─────────────┼─────────────┘
              ┌──────────────┐
              │ Pub/Sub layer │  (Redis pub/sub, Kafka)
              └──────────────┘
                     ▲
              ┌──────────────┐
              │ Connection    │  user_id -> gateway node
              │ registry      │  (Redis, with TTL heartbeats)
              └──────────────┘
```

The problem: a backend service wants to send a message to Alice, but has no idea which of fifty gateway nodes holds her connection. The solution is a **connection registry** mapping user to node (refreshed by heartbeat, expired by TTL so dead nodes clean themselves up), plus a pub/sub layer so any service can publish to a user's channel and the right gateway picks it up. Also mention: **offline delivery** — if the user isn't connected, the message must be persisted and delivered on reconnect, which is why you store notifications rather than only pushing them.

### Mobile push

Mobile devices can't hold WebSockets while backgrounded. You go through **APNs** (Apple) or **FCM** (Google), which maintain a single OS-level connection per device and route your payloads. Your system stores device tokens per user, handles token expiry and unregistration, and treats these as unreliable third parties (retries, rate limits, DLQs — Module 5).

---

## 7.3 Pagination

Never return an unbounded list. Two approaches.

### Offset pagination

```
  GET /items?limit=20&offset=40     ->  SQL: LIMIT 20 OFFSET 40
```

Simple, supports jumping to an arbitrary page. Two real problems:

1. **It gets slower the deeper you go.** `OFFSET 1000000` requires the database to find and discard a million rows. Deep pages are pathologically slow.
2. **Items shift.** If a new item is inserted at the top while a user pages, the item that was #20 becomes #21 and the user sees it twice on page 2. Conversely, deletions cause items to be skipped entirely.

### Cursor (keyset) pagination

```
  GET /items?limit=20&cursor=eyJ0cyI6MTY5OTk5fQ

  ->  SQL: WHERE (created_at, id) < (:cursor_ts, :cursor_id)
           ORDER BY created_at DESC, id DESC
           LIMIT 20
```

The cursor encodes the position of the last item seen. The query uses an index seek rather than a scan-and-discard, so **page 10,000 costs the same as page 1**. And because it's anchored to a specific item rather than a count, insertions don't cause duplicates or skips.

Trade-off: you can only go forward and backward, not jump to page 57. For infinite-scroll feeds that's exactly the right shape.

**The rule:** cursor pagination for feeds, timelines, logs, and anything large or changing. Offset only for small, stable, page-numbered lists like admin tables.

Include the `id` as a tiebreaker in the sort key. Timestamps collide, and without a tiebreaker items with identical timestamps can be duplicated or skipped across page boundaries.

---

## 7.4 API gateway

A single entry point in front of many backend services.

```
  Clients ──► [ API GATEWAY ] ──┬──► Auth service
                                 ├──► Orders service
                                 ├──► Users service
                                 └──► Search service
```

Responsibilities it centralizes so individual services don't each reimplement them:
- TLS termination
- **Authentication and authorization** (validate the token once, pass verified identity downstream)
- **Rate limiting and quota enforcement**
- Request routing and versioning
- Request/response transformation and protocol translation (REST at the edge, gRPC inside)
- Logging, metrics, tracing header injection
- Response caching

**The cost to acknowledge:** it's an extra network hop, a potential bottleneck, and a single point of failure, so it must be replicated and horizontally scaled. There's also a real organizational risk of it becoming a dumping ground for business logic that belongs in services.

**Backend-for-Frontend (BFF)** is a variant: a separate gateway per client type (web, iOS, Android), each shaping responses for its client's needs. Avoids one gateway trying to serve contradictory requirements.

---

## 7.5 Rate limiting

Protects your system from abuse, from accidental client bugs, and from one noisy tenant degrading everyone else. It's also how you enforce paid plan tiers.

### Algorithms

**Fixed window**
Count requests per fixed interval; reset the counter each interval.

```
  [ 10:00:00 - 10:00:59 ]  limit 100
  [ 10:01:00 - 10:01:59 ]  limit 100
```
Trivially simple (a Redis `INCR` with expiry). The flaw: **boundary bursting**. A client can send 100 requests at 10:00:59 and another 100 at 10:01:00 — 200 requests in one second, double the intended rate.

**Sliding window log**
Store a timestamp for every request; count those within the last N seconds. Perfectly accurate, but memory grows with request volume — you're storing every request. Implemented with a Redis sorted set, trimming old entries.

**Sliding window counter**
A compromise: keep counters per fixed window but weight the previous window by how much of it is still in view.

```
  count = current_window_count
        + previous_window_count × (overlap_fraction)
```
Approximate, but nearly as accurate as the log at a tiny fraction of the memory. This is what most production limiters use.

**Token bucket**
A bucket holds up to `B` tokens and refills at `R` tokens per second. Each request consumes a token; if the bucket is empty, the request is rejected.

```
   refill rate R = 10 tokens/sec
   ┌──────────────┐
   │ ● ● ● ● ●    │  capacity B = 50
   └──────┬───────┘
          │ each request takes 1 token
          ▼
      allowed / rejected
```

The important property: it **allows bursts up to the bucket size** while enforcing a long-run average rate. That's usually what you actually want — real traffic is bursty, and clients that have been idle should be allowed to catch up. This is the most widely used algorithm and a good default answer.

**Leaky bucket**
Requests enter a queue and are processed at a fixed rate. Output is perfectly smooth — no bursts pass through at all. Good when the downstream system genuinely cannot absorb bursts (e.g. a third-party API with a hard rate limit). Costs queueing latency.

### Distributed rate limiting

With many API servers, per-server counters don't enforce a global limit. Options:

- **Centralized counter in Redis** using atomic operations (`INCR`, or a Lua script for compare-and-set semantics). Accurate, but adds a network hop per request and makes Redis a dependency of every request.
- **Local counters with a divided quota** — each of 10 servers enforces 1/10th of the limit. No coordination, but unfair under uneven load balancing.
- **Approximate/eventual sync** — local counters that periodically reconcile. Fast and good enough for most limits, with brief overshoot possible.

### What to return

Reject with HTTP **429 Too Many Requests**, and include headers so well-behaved clients can self-regulate:

```
  X-RateLimit-Limit: 100
  X-RateLimit-Remaining: 0
  X-RateLimit-Reset: 1699999999
  Retry-After: 30
```

**What to limit by** is a design question worth raising: by user ID (fair, requires auth), by IP (works for anonymous traffic, but NAT means many users share an IP, and it's easy to evade with a proxy pool), by API key (for partners), or by endpoint (expensive endpoints get tighter limits than cheap ones). Usually several tiers at once.

---

## 7.6 Idempotency at the API layer

Restating Module 3.7 in API terms because it belongs in your API design:

Any non-idempotent endpoint (`POST /payments`, `POST /orders`) should accept an `Idempotency-Key` header. The server stores the key with the response, and a repeat of the same key returns the stored response without re-executing. Keys need a TTL (24 hours is typical) and should be scoped per-user to prevent collisions between clients.

Without this, clients cannot safely retry, which means network timeouts become user-visible failures or duplicate charges.

---

## 7.7 API design details that get noticed

- **Versioning.** Put it in the path (`/v1/users`) for clarity, or in a header for purity. The important part is having a deprecation policy and never making a breaking change to an existing version.
- **Consistent error shapes.** One error envelope with a machine-readable code, a human message, and a correlation ID for support. Use correct status codes: 400 client error, 401 unauthenticated, 403 unauthorized, 404 not found, 409 conflict, 422 validation failure, 429 rate limited, 500 server error, 503 unavailable.
- **Filtering, sorting, and field selection** as query parameters, so clients aren't forced to over-fetch.
- **Bulk endpoints** for operations clients would otherwise loop over, to avoid N round trips.
- **Webhooks** for server-to-server push: let consumers register a URL, sign the payload (HMAC) so they can verify authenticity, retry with backoff on failure, and guarantee at-least-once delivery so consumers must dedupe by event ID. Webhooks are the external-facing cousin of the event bus in Module 5.

---

## Interview checklist for this module

- [ ] Can you choose between REST, gRPC, and GraphQL with a reason tied to the caller?
- [ ] Can you pick SSE vs WebSockets based on whether traffic is one-way or two-way?
- [ ] Can you explain how to route a message to a user across many WebSocket nodes?
- [ ] Do you use cursor pagination for feeds and explain why offset degrades?
- [ ] Can you describe token bucket and why burst tolerance is usually desirable?
- [ ] Do you mention 429 plus `Retry-After` rather than just "reject"?
- [ ] Do you add an idempotency key to any endpoint that moves money or creates records?
