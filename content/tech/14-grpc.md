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
concepts:
  - "**The schema is the contract** — generated clients in every language, and field *numbers* on the wire"
  - "**Evolution rules** — add fields with new numbers, reserve retired ones, never renumber or change a type"
  - "**Protobuf is compact** — a half to a third of JSON, and much faster to parse, which shows up in a fan-out p99"
  - "**HTTP/2 multiplexing** — many concurrent calls on one connection, with no HTTP-level head-of-line blocking"
  - "**Deadlines propagate** — one budget travels the whole chain, so five hops all know how long is left"
  - "**Cancellation is real** — a client that goes away stops downstream work instead of paying for it"
  - "**Interceptors** — auth, tracing, retries and metrics in one place per service"
  - "**One connection defeats L4 balancing** — you need client-side balancing or an L7 proxy or mesh"
  - "**REST or GraphQL at the edge, gRPC between services, a log when it need not be synchronous**"
---

# gRPC

## Use cases

### Service-to-service calls with one deadline

Behind the edge, where payload size and parse cost show up in the p99 and every
caller is your own code. The deadline set at the gateway travels with the call,
so the fifth hop knows how much budget is left and abandons work nobody is
waiting for.

```mermaid
flowchart TB
    Browser([Browser / mobile]) -- "REST or GraphQL<br/>cacheable, debuggable" --> GW["API gateway"]
    GW -- "gRPC · deadline 200 ms" --> S1["Orders"]
    GW -- "gRPC" --> S2["Pricing"]
    S1 -- "gRPC · 140 ms left" --> S3["Inventory"]
    S3 -. "budget gone → cancel,<br/>nobody is waiting" .-> S3
    S1 -. "does not need an answer now" .-> K{{"Kafka"}}

    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class K queue
    class GW hot
```

### Changing a message without breaking a caller

Field numbers, not names, are on the wire, so an old server ignores a field it
has never heard of and a new server reads an old message fine. That is the
property that makes a polyglot estate with dozens of services survivable.

```mermaid
flowchart TB
    V1["order.proto v1<br/>1: id · 2: total"] --> Gen["Generated clients<br/>Go · Java · Python"]
    V2["order.proto v2<br/>+ 3: currency<br/>reserved 2"] --> Gen
    Gen --> Old["Old server<br/>ignores field 3"]
    Gen --> New["New server<br/>reads v1 messages"]
    Bad(["Renumber or retype a field"]) -. "silent corruption — never do this" .-> Old

    classDef hot stroke:#e8a33d,stroke-width:2px
    class V2 hot
```

### Streaming telemetry between backends

Bidirectional streaming over one connection is what makes continuous flows —
driver locations, metrics, live model scores — cheap: no per-message request
overhead, and flow control that pushes back when the consumer falls behind.

```mermaid
flowchart TB
    Edge(["Location gateway"]) -- "client stream<br/>positions every 4s" --> Svc["Tracking service"]
    Svc -- "server stream<br/>assignments, corrections" --> Edge
    Svc -. "HTTP/2 flow control:<br/>slow consumer pushes back" .-> Edge
    Svc --> K{{"Kafka · for anything durable"}}

    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class K queue
    class Svc hot
```

### Balancing load across one long connection

The trap that separates reading about gRPC from running it: HTTP/2 keeps a single
connection, so a connection-level balancer pins a client to one backend forever.
Balance per request instead — in the client, or in an L7 proxy or mesh.

```mermaid
flowchart TB
    C1([Client]) -- "one HTTP/2 connection" --> L4["L4 load balancer"]
    L4 -. "pins every call to one backend" .-> B1["Backend 1<br/>saturated"]
    L4 -. "idle" .-> B2["Backend 2"]
    C2([Client]) -- "client-side balancing<br/>or an L7 proxy / mesh" --> Bal["Per-request balancing"]
    Bal --> B3["Backend A"]
    Bal --> B4["Backend B"]
    Bal --> B5["Backend C"]

    classDef hot stroke:#e8a33d,stroke-width:2px
    class B1 hot
```
