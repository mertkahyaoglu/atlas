---
group: "tech"
order: 13
title: "WebSockets"
role: "Push transport"
summary: "Persistent connections for server push — and the stateful tier, routing and reconnect story they drag in."
tags: ["websockets", "realtime", "fanout", "reliability", "redis"]
facts:
  - label: "What it is"
    value: "An HTTP `Upgrade` into a persistent, full-duplex TCP connection"
  - label: "Overhead"
    value: "A few bytes of framing per message, not a full request"
  - label: "The tier"
    value: "Stateful: it scales on open connections and memory, not CPU"
  - label: "Routing"
    value: "A registry in Redis, or pub/sub per channel"
  - label: "Liveness"
    value: "Ping frames — TCP will not tell you a phone entered a tunnel"
  - label: "Guarantee"
    value: "None. Persist first, push second, resume from a cursor"
concepts:
  - "**Pick the cheapest transport** — polling, long polling, SSE, then WebSockets; if the client only receives, SSE wins"
  - "**The tier is stateful** — it scales on open connections and memory per connection, not on CPU"
  - "**Routing is the real problem** — the message arrives at one node, the socket lives on another"
  - "**Two answers**: a `user → node` registry in Redis, or pub/sub where each node subscribes for its own connections"
  - "**Heartbeats** — ping frames and a timeout, because a phone in a tunnel does not close its TCP connection"
  - "**Persist first, push second** — the socket is a transport, never the delivery guarantee"
  - "**Reconnect and backfill** — the client resumes from its last message id and the server serves the gap"
  - "**Deploys drain, they do not cut** — otherwise every client reconnects at once, against you"
  - "**Fan-out costs sends** — a 100k-member room is 100k pushes; batch per node, or reconsider a pull-based feed"
---

# WebSockets

## Use cases

### Delivering a chat message to the right node

The whole design in one picture: the sender's socket is on node 1, the
recipient's on node 7, and the message has to cross. Persist before publishing,
so a dropped push costs a reconnect rather than a message.

```mermaid
flowchart TB
    A([User A]) -- "WSS" --> GW1["Socket node 1<br/>holds A's connection"]
    GW1 -- "1 · send" --> API["Chat service"]
    API -- "2 · persist first" --> DB[("Store<br/>message_id, durable")]
    API -- "3 · publish user:B" --> Redis{{"Redis pub/sub<br/>or a user → node registry"}}
    Redis -- "4 · push" --> GW2["Socket node 7<br/>holds B's connection"]
    GW2 -- "WSS" --> B([User B])

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class DB db
    class Redis queue
    class API hot
```

### Coming back after the tunnel

Connections drop constantly, so the interesting path is the reconnect: the client
sends the highest message id it holds, the server returns everything after it
from durable storage, and only then does the live stream resume.

```mermaid
flowchart TB
    Client([Client · offline 3 min]) -- "1 · reconnect with jittered backoff" --> GW["Socket node"]
    GW -- "2 · last_seen_id = 4711" --> API["Chat service"]
    API -- "3 · SELECT … WHERE id > 4711" --> DB[("Store")]
    DB -- "4 · the gap, in order" --> Client
    API -. "5 · live pushes resume" .-> Client
    Client -. "dedupe on message_id<br/>at-least-once is fine" .-> Client

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class DB db
    class API hot
```

### Presence, without lying about it

Presence is heartbeats plus a TTL: each node refreshes a key while the socket is
alive, and the key expiring *is* the disconnect event. Without it, TCP will
happily hold a connection to a phone that left the network minutes ago.

```erd
# Presence · Redis, all keys expire
presence:{user_id} || refreshed by the socket node every 20s; the TTL expiring is the disconnect || Redis hash
+ node_id || text
+ last_ping || timestamp
+ ttl || 45 seconds
conn:{node_id} || which sockets a node holds, so a restart can clean up after itself || set
+ member || user_id
```

### Fanning out to a big room

One message to a 100k-member channel is 100k sends. Batch per node so the
publish crosses the network once per node rather than once per member — and at
some size, admit that a pull-based feed is the right answer instead.

```mermaid
flowchart TB
    Msg([Message to room 42]) --> Svc["Chat service"]
    Svc -- "one publish per node,<br/>not per member" --> PS{{"Pub/sub · channel room:42"}}
    PS --> N1["Node 1<br/>fan out to 30k local sockets"]
    PS --> N2["Node 2<br/>25k sockets"]
    PS --> N3["Node 3<br/>45k sockets"]
    N1 -. "at this size, consider a feed<br/>the client pulls" .-> Feed(["Pull-based feed"])

    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class PS queue
    class Svc hot
```
