---
group: "tech"
order: 13
title: "WebSockets"
role: "Push transport"
summary: "Persistent connections for server push — and the stateful tier, routing and reconnect story they drag in."
tags: ["websockets", "realtime", "fanout", "reliability", "redis"]
---

# WebSockets

## Basics

A WebSocket starts as an HTTP request with an `Upgrade` header and becomes a
persistent, full-duplex TCP connection. Either side can send a message at any
time, with a few bytes of framing overhead instead of a full HTTP request.

The alternatives matter as much as the thing itself, and choosing correctly is
most of the credit:

| | Direction | Cost | Use it when |
| --- | --- | --- | --- |
| Polling | Client asks | Wasteful, high latency | Updates are rare and seconds do not matter |
| Long polling | Client asks, server holds | One connection per pending update | Simple push, legacy-friendly |
| SSE | Server → client only | One HTTP connection, auto-reconnect built in | Feeds, notifications, live dashboards |
| WebSocket | Both ways | Stateful connection per client | Chat, collaboration, multiplayer |

If the client never needs to push over the same channel, **SSE is the better
answer**: it is plain HTTP, it reconnects with a `Last-Event-ID` for free, and it
survives proxies. Reaching for WebSockets when server-to-client is all you need is
a common over-engineering tell.

## Key concepts and capabilities

**The connection tier is stateful, and that changes the architecture.** Your
stateless API servers can scale on CPU; a socket tier scales on **number of open
connections** and memory per connection. A million connections at a few kilobytes
each is gigabytes of memory doing nothing but waiting, spread over enough nodes
that losing one is survivable.

**Routing is the real problem.** User A's socket is on server 7; the message for
them arrives at server 3. Two standard answers:

- A **connection registry** in Redis mapping `user → server`, and server 3 delivers directly to server 7.
- **Pub/sub**: every server subscribes to the channels its connections care about, and a publish fans out to whichever servers hold subscribers. Simpler, and the usual choice until the fan-out gets expensive.

**Heartbeats.** TCP will not tell you a phone went into a tunnel. Ping frames on an
interval, with a timeout that closes the connection and cleans up the registry
entry, are what keep presence honest.

**Reconnect and backfill.** Connections drop constantly — mobile networks, laptop
lids, deploys. The client must reconnect with backoff and resume from the last
message id it saw, and the server must be able to serve the gap from durable
storage. **The socket is a transport, not the delivery guarantee**: every message
worth delivering is persisted first and pushed second.

**Deploys drain, they do not cut.** Rolling a socket tier disconnects everyone at
once and they all reconnect together — a thundering herd against your own service.
Drain gradually, and make clients reconnect with jitter.

## When to use it in an interview

Chat and messaging, collaborative editing, presence and typing indicators,
multiplayer state, live location tracking for a ride or a delivery, trading and
live scores, and notifications where a few seconds of delay is visible.

The right way to introduce it is to say what it costs at the same time: "clients
hold WebSockets to a dedicated gateway tier; that tier is stateful, so I need a
connection registry in Redis, heartbeats, and a resume-from-cursor path on
reconnect". That sentence covers most of what the follow-ups would have asked.

Do not use it for request/response — a normal HTTP call is simpler and cacheable —
or for updates that can be batched into a poll every thirty seconds.

## What interviewers push on

- **Which server holds this user's socket?** The registry or pub/sub answer above. This is the question, and having no answer is the most common failure.
- **What happens on reconnect?** Resume with the last seen message id, server returns everything since. Say where that history lives.
- **How many connections per node, and how many nodes?** Do the arithmetic out loud: 1M concurrent users, ~40k connections per node, so 25 nodes plus headroom.
- **Load balancing.** Long-lived connections mean stickiness and uneven distribution; a node that restarts takes its share of reconnects. Least-connections routing plus jittered client backoff.
- **Fan-out to a large room.** A 100k-member channel means 100k sends per message. Batch per server, and consider whether the answer is really a pull-based feed.
- **Why not SSE?** Have the one-line answer. If the client only receives, SSE is less machinery — and saying so when it is true reads much better than defaulting to WebSockets.
