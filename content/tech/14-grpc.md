---
group: "tech"
order: 14
title: "gRPC"
role: "Internal RPC"
summary: "Typed, binary, streaming RPC over HTTP/2 — the default for service-to-service calls behind the edge."
tags: ["grpc", "observability", "circuit-breaker", "api-gateway"]
facts:
  - label: "Contract"
    value: "A `.proto` file; clients and servers are generated from it"
  - label: "Encoding"
    value: "Protocol Buffers — a half to a third the size of JSON"
  - label: "Transport"
    value: "HTTP/2: multiplexed calls on one connection, flow control"
  - label: "Call shapes"
    value: "Unary, server streaming, client streaming, bidirectional"
  - label: "Failure handling"
    value: "Deadlines propagate down the chain; cancellation is real"
  - label: "Browsers"
    value: "Not directly — gRPC-Web plus a proxy, or REST at the edge"
capabilities:
  - title: "The contract is the schema"
    body: |-
      Field numbers, not names, travel on the wire, which gives clear evolution rules: add fields freely with new numbers, never reuse or renumber, never change a type, reserve numbers you retire. An old server ignores fields it does not know.

      That compatibility discipline is the real reason large polyglot systems adopt it.
  - title: "Deadlines propagate"
    body: |-
      A client sets a deadline and it travels with the call, so a chain of five services all know the remaining budget and abandon work when it is gone.

      Strictly better than each hop inventing its own timeout — and worth naming when an interviewer asks about cascading failures.
  - title: "Load balancing is different"
    body: |-
      Because HTTP/2 keeps one long-lived connection, a connection-level load balancer pins a client to one backend and the traffic does not spread.

      The answers are client-side load balancing with service discovery, or an L7 proxy or service mesh that balances per request. Knowing this is a strong signal of having actually run it.
  - title: "Interceptors"
    body: |-
      The middleware layer: auth, tracing, retries and metrics in one place per service, rather than scattered through handlers.
useWhen:
  - "**Internal, east-west traffic** where call volume is high and latency matters"
  - "A gateway calls a dozen services to render one screen, and serialisation shows up in the p99"
  - "A polyglot estate needs one enforced contract with generated clients"
  - "Streaming telemetry or location updates between backends"
avoidWhen:
  - "At the edge: REST wins on cacheability, browser support, debuggability and third-party integration"
  - "Clients need to shape their own queries — that is GraphQL"
  - "The call does not need an answer now: a message log beats a synchronous RPC, and this is the most common mistake"
probes:
  - question: "Why not REST internally?"
    answer: "Smaller payloads, generated typed clients, streaming, propagated deadlines. Then acknowledge the cost: harder to curl, needs tooling, no browser support."
  - question: "How does load balancing work with one long-lived connection?"
    answer: "It doesn't, by default — the client pins to a backend. Client-side load balancing with service discovery, or an L7 proxy or mesh balancing per request. This is the question that separates reading about gRPC from running it."
  - question: "How do you evolve a message?"
    answer: "Add fields with new numbers, reserve retired ones, never renumber or change a type. Old clients keep working, which is the point."
  - question: "The dependency is down and calls are piling up."
    answer: "Deadlines, retries on idempotent methods only, backoff with jitter, and a circuit breaker. The deadline is the part people forget."
  - question: "You already run a service mesh. What changes?"
    answer: "mTLS, retries and tracing come from the sidecar, so you say that rather than reimplementing them in interceptors."
  - question: "How do you debug a binary protocol?"
    answer: "Server reflection, `grpcurl`, and good tracing. It is a real cost, and naming it reads better than pretending otherwise."
---

# gRPC

## How it works

gRPC is a remote procedure call framework. You define services and messages in a
`.proto` file, generate client and server code in whatever languages you use, and
call a remote method as if it were local. Messages travel as **Protocol Buffers** —
a compact binary encoding, typically half to a third the size of the equivalent
JSON and much faster to parse.

It runs over **HTTP/2**, which brings multiplexing (many concurrent calls on one
connection, no head-of-line blocking at the HTTP layer), binary framing, header
compression and flow control. One TCP connection carries the traffic that REST
would spread over a pool.

```mermaid
flowchart TB
    Browser([Browser / mobile]) -- "REST or GraphQL<br/>cacheable, debuggable" --> GW["API gateway"]
    GW -- "gRPC · deadline 200ms" --> S1["Orders"]
    GW -- "gRPC" --> S2["Pricing"]
    S1 -- "gRPC · remaining budget travels" --> S3["Inventory"]
    S1 -. "does not need an answer now" .-> K{{"Kafka"}}
    Proxy["L7 proxy / mesh<br/>balances per request, not per connection"] --- S1

    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class K queue
    class Proxy hot
```

The dashed edge is the decision most often got wrong: a synchronous RPC where an
event would do. The annotated proxy is the second: one long-lived HTTP/2
connection needs request-level balancing, or all your traffic lands on one
backend.

## Where it fits in a design

> *REST or GraphQL for clients, gRPC between services, Kafka when it does not
> need to be synchronous.*

That one line answers the transport question for most designs, and leaves you
time for the parts that are actually hard.
