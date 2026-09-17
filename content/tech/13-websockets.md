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
capabilities:
  - title: "Pick the cheapest transport that works"
    body: |-
      | | Direction | Cost | Use it when |
      | --- | --- | --- | --- |
      | Polling | Client asks | Wasteful, high latency | Updates are rare and seconds do not matter |
      | Long polling | Client asks, server holds | One connection per pending update | Simple push, legacy-friendly |
      | SSE | Server → client only | One HTTP connection, auto-reconnect built in | Feeds, notifications, live dashboards |
      | WebSocket | Both ways | Stateful connection per client | Chat, collaboration, multiplayer |

      If the client never pushes over the same channel, **SSE is the better answer**: plain HTTP, free reconnect with `Last-Event-ID`, and it survives proxies.
  - title: "The connection tier is stateful"
    body: |-
      Stateless API servers scale on CPU; a socket tier scales on **open connections** and memory per connection.

      A million connections at a few kilobytes each is gigabytes of memory doing nothing but waiting, spread over enough nodes that losing one is survivable.
  - title: "Heartbeats"
    body: |-
      Ping frames on an interval, with a timeout that closes the connection and cleans up the registry entry, are what keep presence honest.
  - title: "Reconnect and backfill"
    body: |-
      Connections drop constantly — mobile networks, laptop lids, deploys. The client reconnects with backoff and resumes from the last message id it saw, and the server serves the gap from durable storage.

      **The socket is a transport, not the delivery guarantee.**
  - title: "Deploys drain, they do not cut"
    body: |-
      Rolling a socket tier disconnects everyone at once and they all reconnect together — a thundering herd against your own service. Drain gradually, and make clients reconnect with jitter.
useWhen:
  - "Chat and messaging, collaborative editing, presence and typing indicators"
  - "Multiplayer state, live location for a ride or a delivery, trading and live scores"
  - "Notifications where a few seconds of delay would be visible"
avoidWhen:
  - "The client only receives — SSE is less machinery, and saying so reads better"
  - "It is request/response: a normal HTTP call is simpler and cacheable"
  - "Updates can be batched into a poll every thirty seconds"
probes:
  - question: "Which server holds this user's socket?"
    answer: "A connection registry in Redis mapping user → server, or pub/sub where each server subscribes for its own connections. This is *the* question, and having no answer is the most common failure."
  - question: "What happens on reconnect?"
    answer: "The client sends the last message id it saw and the server returns everything since. Say where that history lives — it is not in the socket tier."
  - question: "How many nodes?"
    answer: "Do the arithmetic out loud: 1M concurrent users at ~40k connections per node is 25 nodes, plus headroom for a node failing and its share reconnecting."
  - question: "How do you load balance long-lived connections?"
    answer: "Stickiness and uneven distribution are given. Least-connections routing, jittered client backoff, and draining on deploy."
  - question: "A 100k-member channel gets a message."
    answer: "100k sends. Batch per server holding subscribers, and ask whether a pull-based feed is the real answer at that size."
  - question: "Why not SSE?"
    answer: "Have the one-liner: the client needs to push on the same channel, or the protocol needs to be binary. Otherwise SSE."
---

# WebSockets

## How it works

A WebSocket starts as an HTTP request with an `Upgrade` header and becomes a
persistent, full-duplex TCP connection. Either side can send a message at any
time, with a few bytes of framing overhead instead of a full HTTP request.

The hard part is not the protocol; it is that the tier holding the connections is
stateful, so the message and the socket rarely arrive at the same node.

```mermaid
flowchart TB
    A([User A]) -- "WSS" --> GW1["Socket node 1<br/>holds A's connection"]
    GW1 -- "1 · send" --> API["Chat service"]
    API -- "2 · persist first" --> DB[("Store<br/>message_id, durable")]
    API -- "3 · publish user:B" --> Redis{{"Redis pub/sub<br/>or a user → node registry"}}
    Redis -- "4 · push" --> GW2["Socket node 7<br/>holds B's connection"]
    GW2 -- "WSS" --> B([User B])
    B -. "5 · reconnect: last_seen_id" .-> API
    API -. "gap from the store" .-> B

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class DB db
    class Redis queue
    class API hot
```

Step 2 before step 3 is the whole reliability story: the message is durable before
anyone is told about it, so a dropped publish costs a round trip on reconnect
rather than a lost message.

## Where it fits in a design

> The right way to introduce it is to say what it costs in the same breath:
> *"clients hold WebSockets to a dedicated gateway tier; that tier is stateful, so
> I need a connection registry in Redis, heartbeats, and a resume-from-cursor path
> on reconnect."*

That sentence answers most of the follow-ups before they are asked.
