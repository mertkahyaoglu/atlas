---
group: "tech"
order: 14
title: "gRPC"
role: "Internal RPC"
summary: "Typed, binary, streaming RPC over HTTP/2 — the default for service-to-service calls behind the edge."
tags: ["grpc", "observability", "circuit-breaker", "api-gateway"]
---

# gRPC

## Basics

gRPC is a remote procedure call framework. You define services and messages in a
`.proto` file, generate client and server code in whatever languages you use, and
call a remote method as if it were local. Messages travel as **Protocol Buffers** —
a compact binary encoding, typically half to a third the size of the equivalent
JSON and much faster to parse.

It runs over **HTTP/2**, which brings multiplexing (many concurrent calls on one
connection, no head-of-line blocking at the HTTP layer), binary framing, header
compression and flow control. One TCP connection carries the traffic that REST
would spread over a pool.

Four call shapes: unary (one request, one response), server streaming, client
streaming, and bidirectional streaming.

## Key concepts and capabilities

**The contract is the schema.** Field numbers, not names, are on the wire, which
gives clear evolution rules: add fields freely with new numbers, never reuse or
renumber, never change a type, and reserve numbers you retire. An old server
ignores fields it does not know. That compatibility discipline is the real reason
large polyglot systems adopt it.

**Deadlines propagate.** A client sets a deadline and it travels with the call, so
a chain of five services all know the remaining budget and abandon work when it is
gone. This is strictly better than each hop having its own arbitrary timeout, and
it is worth naming when an interviewer asks about cascading failures.

**Cancellation is real.** A client that goes away cancels the RPC and downstream
work can stop instead of finishing for nobody.

**Interceptors** are the middleware layer: auth, tracing, retries, metrics, in one
place per service.

**Load balancing is different.** Because HTTP/2 keeps one long-lived connection, a
connection-level load balancer will pin a client to one backend and the traffic
will not spread. The answers are client-side load balancing with service discovery,
or an L7 proxy or service mesh that balances per request. Knowing this is a strong
signal of having actually run it.

**Browsers cannot speak it directly.** gRPC-Web plus a proxy exists; in practice
the public API is REST or GraphQL at the gateway and gRPC behind it.

## When to use it in an interview

Use it for **internal, east-west traffic** where call volume is high and latency
matters: a gateway calling a dozen services to render a screen, a fan-out where
serialisation cost shows up in the p99, a polyglot estate that needs one enforced
contract, or streaming telemetry and location updates between backends.

Use REST at the edge, where cacheability, browser support, debuggability and third
party integration all matter more than bytes on the wire. Use GraphQL at the edge
when clients need to shape their own queries and you want to kill a round of
over-fetching. Use a message log instead of any of them when the call does not
need an answer now — the most common mistake is a synchronous RPC where an event
would do.

The one-line version worth having ready: *REST or GraphQL for clients, gRPC
between services, Kafka when it does not need to be synchronous.*

## What interviewers push on

- **Why not REST internally?** Smaller payloads, generated typed clients, streaming, propagated deadlines. Then acknowledge the cost: harder to curl, needs tooling, no browser support.
- **How does load balancing work?** The HTTP/2 stickiness problem and its two answers. This is the question that separates having read about gRPC from having used it.
- **Versioning.** Field numbers, additive changes, reserved tags, and never breaking an old client.
- **Failure handling.** Deadlines, retries on idempotent methods only, backoff with jitter, and a circuit breaker on a dependency that is down.
- **Where does the mesh fit?** If you already have a sidecar mesh doing mTLS, retries and tracing, gRPC gets those for free and you say so rather than reimplementing them.
- **Debuggability.** Binary payloads mean you need reflection, `grpcurl` and good tracing. It is a real cost, and naming it is better than pretending otherwise.
