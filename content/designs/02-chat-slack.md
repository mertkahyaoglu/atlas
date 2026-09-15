---
group: "design"
order: 2
title: "Chat / Slack"
summary: "Fifty million concurrent sockets, ordered message delivery, and users who go offline mid-conversation."
hardPart: "You have fifty stateful gateway nodes and a message for Alice. How does the sender find the node holding her socket, and what happens when she's offline?"
tags: ["realtime", "websockets", "cassandra", "idempotency"]
hardPartDetail: "You have 50 stateful gateway nodes and a message for Alice. How does the sender's request find the node holding Alice's socket? And what happens when Alice is offline?"
concepts:
  - "WebSockets"
  - "connection registry"
  - "pub/sub routing"
  - "message ordering"
  - "offline delivery"
  - "wide-column storage"
  - "fan-out (small)"
  - "push notifications"
requirements:
  functional:
    - "1:1 and group messaging"
    - "Real-time delivery to online users"
    - "Offline users receive messages on reconnect"
    - "Delivery receipts: sent → delivered → read"
    - "Online/presence status"
    - "Message history with pagination"
  nonFunctional:
    - "Delivery latency p99 < 500ms for online users"
    - "Messages must never be lost (durable before ack)"
    - "Consistent ordering *within a conversation*"
    - "Availability over global consistency"
  outOfScope: "voice/video calls, E2E encryption key exchange (mention it exists), file transfer specifics, search."
scale:
  numbers: |-
    500M DAU · 50M concurrent connections
    Messages: 100B/day → ~1.2M/sec avg, 4M/sec peak
    Msg row ~200B → 20 TB/day
    Connections per gateway node: ~50k → need ~1,000 gateway nodes
  conclusion: "50M concurrent sockets means the gateway tier is its own scaling problem, separate from storage. That's why it's drawn as a distinct tier."
tradeoffs:
  - title: "Ordering"
    body: |-
      Message order is defined by the server-assigned Snowflake ID, not by client timestamps (clocks lie, networks reorder). Because all messages in a conversation share a partition key, they are stored in one ordered log. Clients sort by `message_id`, which is monotonic per conversation. Ordering *across* conversations doesn't matter and isn't guaranteed.
  - title: "Durability before ack"
    body: |-
      The sender gets "sent" only after the message is committed to storage. If you ack on receipt at the gateway and the gateway dies, the message vanishes with a checkmark showing. Never ack before durable.
  - title: "Idempotency"
    body: |-
      Client generates `client_msg_id` (a UUID). Retries on flaky mobile networks reuse it. Server dedupes, so a retry returns the original `message_id` rather than creating a duplicate. This is the single most important detail for mobile chat.
  - title: "Why a connection registry and not \"just broadcast to all gateways\""
    body: |-
      Broadcasting every message to 1,000 gateways is 1,000x write amplification on the pub/sub layer. The registry turns a broadcast into a targeted publish. Cost: an extra Redis lookup and a consistency window when a user reconnects to a different node (handled by TTL + the fact that a stale publish simply finds no socket and falls through to the offline path).
  - title: "Gateway nodes are stateful — accept it, then contain it"
    body: |-
      This violates the stateless ideal from Module 1. Contain it by keeping *only* the socket on the node; all durable state lives elsewhere. A gateway dying just means clients reconnect and re-register.
  - title: "Group chat fan-out"
    body: |-
      Slack channels with 50,000 members are the celebrity problem again. For small groups, push to each member. For very large channels, don't push to everyone — clients that have the channel open subscribe to a channel-level pub/sub topic, and everyone else pulls on open. Same hybrid shape as the feed.
  - title: "Presence is expensive"
    body: |-
      Naive presence (broadcast every status change to everyone who might care) is a fan-out explosion. Mitigations: only compute presence for conversations the user currently has open, batch updates on a few-second interval, and treat presence as best-effort/lossy. Say out loud that presence is the most over-engineered part of most chat designs.
  - title: "Read receipts"
    body: |-
      Store `last_read_msg_id` per (user, conversation) rather than a per-message read flag. One row updated instead of N. Unread count = count of messages with id > last_read_msg_id, which is a bounded range scan, or a cached counter.
  - title: "Storage partitioning risk"
    body: |-
      A busy channel is a hot partition. Bound partition size by bucketing the key: `PK = (conversation_id, time_bucket)`. Reads for recent history hit the newest bucket.
  - title: "E2E encryption"
    body: |-
      If required, the server stores ciphertext only and cannot do server-side search, previews, or moderation. Say this trade explicitly — it removes features, not just adds security.
followUps:
  - question: "How do you guarantee exactly-once display?"
    answer: "You don't guarantee exactly-once delivery — you dedupe on `message_id` client-side. At-least-once + idempotent rendering."
  - question: "What if a client is on a flaky network and misses pushes?"
    answer: "Client tracks its highest received `message_id` per conversation and sends it on reconnect; server replies with everything after it. This \"sync from cursor\" model is more robust than relying on the inbox queue alone."
  - question: "How do you scale to 50M concurrent connections?"
    answer: "~50k connections per node is the practical ceiling (file descriptors, memory per socket). So ~1,000 nodes, autoscaled on connection count, fronted by an L4 balancer. Connection *establishment* rate is its own bottleneck — thundering-herd reconnects after a deploy need jittered backoff on the client."
  - question: "Message editing and deletion?"
    answer: "Append a new event referencing the original; clients apply it. Don't mutate history in place — it breaks the append-only ordering model."
  - question: "How does search work?"
    answer: "Separate path entirely: CDC from the messages store into Elasticsearch, per-workspace index. Never search the primary store."
  - question: "Multi-device?"
    answer: "The registry maps `user_id → [list of connections]`, not one. Deliver to all; read state syncs server-side so all devices converge."
---
# 02 — Chat / Slack / WhatsApp

## API / Model

```api
# WebSocket · auth via token in handshake
WS wss://chat.example.com/connect || || 101
+ → client sends: {type:"send", client_msg_id, conv_id, body}
+ ← server sends: {type:"message"|"receipt"|"presence", ...}
# REST · history and setup
GET /v1/conversations?cursor= || || 200 conversation list
GET /v1/conversations/{id}/messages?cursor=&limit=50 || || 200 message page
POST /v1/conversations || {member_ids[]} || 201 conversation_id
POST /v1/conversations/{id}/read || {up_to_msg_id} || 204
```

```schema
messages || PK: conversation_id SK: message_id (Snowflake, DESC) || sender_id, body, created_at, type || one partition per conversation = ordered, cheap range reads
conversations || PK: conversation_id || type (dm|group), member_count, last_message_id ||
members || PK: user_id SK: conversation_id || last_read_msg_id, muted, joined_at || powers "my conversation list" and unread counts
inbox_queue || PK: user_id SK: message_id || undelivered messages only || offline delivery buffer; rows deleted on ack
```

---

## High-level architecture

```mermaid
flowchart TB
    A([Client A]) -- "WSS" --> GWA["WS Gateway #17<br/>holds A's socket"]
    GWA --> Chat

    subgraph CHAT ["Chat Service"]
        direction TB
        Chat["Validate and authorize<br/>assign Snowflake message_id<br/>dedupe on client_msg_id"]
        Durable[("messages store · Cassandra<br/>PK = conversation_id<br/>SK = message_id DESC")]
        Chat -- "1 · durable write first" --> Durable
        Durable -- "2 · then ack sender" --> Chat
    end

    Chat -- "3 · resolve recipient" --> Registry
    Registry[("Connection registry · Redis<br/>user_id → gateway node<br/>TTL + heartbeat")]
    Registry --> Online{"recipient online?"}

    Online -- "yes" --> PubSub{{"Pub/sub · channel gw:42"}}
    PubSub --> GWB["WS Gateway #42<br/>holds B's socket"]
    GWB -- "WSS" --> B([Client B])

    Online -- "no" --> Inbox[("inbox_queue<br/>undelivered rows")]
    Inbox --> Push["APNs / FCM<br/>mobile push"]
    Inbox -. "on reconnect: drain backlog,<br/>client acks, rows deleted" .-> GWB

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef external fill:#2f5a4d,stroke:#5cc98f,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Durable,Inbox db
    class Registry cache
    class Online hot
    class PubSub queue
    class Push external

    click GWA href "/docs/07-apis-and-communication" "Role: keeps sender A's persistent connection and forwards messages inward.<br/>Trade-off: a stateful node, and a crash drops thousands of sockets that all reconnect."
    click GWB href "/docs/07-apis-and-communication" "Role: pushes messages to B over the socket it holds.<br/>Trade-off: sticky state, so rebalancing gateways causes reconnect storms."
    click Durable href "/docs/02-data-storage" "Role: persists every message before the sender gets an ack, one partition per conversation.<br/>Trade-off: very large group chats turn into hot partitions."
    click Registry href "/docs/07-apis-and-communication" "Role: finds which gateway holds the recipient's socket.<br/>Trade-off: entries go stale when a gateway crashes, and TTL heartbeats bound how wrong they get."
    click PubSub href "/docs/05-async-messaging-and-event-driven" "Role: delivers to the one gateway holding B instead of every node.<br/>Trade-off: fire-and-forget, so the inbox queue covers anything it loses."
```

<details>
<summary>Plain-text version of this diagram</summary>

```text
 [Client A]                                              [Client B]
     │  persistent WSS                     persistent WSS  │
     ▼                                                     ▼
┌─────────────────┐                              ┌─────────────────┐
│  L4 Load Bal.   │  (sticky, long-lived conns)  │  L4 Load Bal.   │
└────────┬────────┘                              └────────┬────────┘
         ▼                                                 ▼
┌────────────────────┐                          ┌────────────────────┐
│  WS GATEWAY  #17   │                          │  WS GATEWAY  #42   │
│  holds A's socket  │                          │  holds B's socket  │
└─────┬──────────────┘                          └──────────▲─────────┘
      │ 1. inbound message                                 │ 6. push to B
      ▼                                                    │
┌─────────────────────────────────────────────────────┐   │
│               CHAT SERVICE                           │   │
│  · validate, authorize (is A in this conversation?)  │   │
│  · assign message_id (Snowflake) → ORDERING          │   │
│  · dedupe on client_msg_id (idempotency)             │   │
└───┬──────────────────────────────────────┬──────────┘   │
    │ 2. DURABLE WRITE FIRST               │              │
    ▼                                       │              │
┌──────────────────┐                        │              │
│  messages store  │  Cassandra             │              │
│  PK=conv_id      │  partitioned by conv   │              │
│  SK=msg_id DESC  │                        │              │
└──────────────────┘                        │              │
    │ 3. ack to sender (only after durable) │              │
    │                                        │              │
    │           4. resolve recipients        ▼              │
    │        ┌──────────────────────────────────────┐      │
    │        │  CONNECTION REGISTRY (Redis)          │      │
    │        │  user_id → gateway_node_id            │      │
    │        │  TTL + heartbeat (dead nodes expire)  │      │
    │        └───────────┬──────────────────────────┘      │
    │                    │                                  │
    │     ┌──────────────┴───────────────┐                 │
    │     │ ONLINE?                       │                 │
    │     ├───────────────┬───────────────┤                 │
    │     │ YES           │ NO            │                 │
    │     ▼               ▼               │                 │
    │  ┌──────────────┐ ┌─────────────────────┐            │
    │  │ PUB/SUB      │ │  inbox_queue write  │            │
    │  │ (Redis/Kafka)│ │  + push notification│            │
    │  │ channel:     │ └──────────┬──────────┘            │
    │  │  gw:42       │            ▼                        │
    │  └──────┬───────┘   ┌──────────────────┐             │
    │         │ 5.        │  APNs / FCM      │             │
    │         └───────────┼──► mobile push   │             │
    │                     └──────────────────┘             │
    │                                                       │
    └───────────────────────────────────────────────────────┘

          ON RECONNECT (B comes back online):
          ┌────────────────────────────────────────┐
          │ B connects → gateway registers in      │
          │ registry → drains inbox_queue for B    │
          │ → sends backlog → B acks → rows deleted│
          └────────────────────────────────────────┘
```

</details>

The design puts a stateless Chat Service between two stateful gateways: one holds the sender's socket and one holds the recipient's. A Redis connection registry links them, and every message is stored before anyone is told about it.

1. Client A sends the message over WSS to WS Gateway #17, which holds A's socket and forwards it to the Chat Service. The Chat Service validates and authorizes it, assigns a Snowflake `message_id`, dedupes on `client_msg_id`, and writes it to the messages store, where it lands in the `conversation_id` partition.
2. Only after that write succeeds does the Chat Service ack the sender.
3. It then resolves the recipient in the connection registry, which maps `user_id` to the gateway node holding that user's socket and expires stale entries through TTL and heartbeats.
4. If the recipient is online, the Chat Service publishes to that node's pub/sub channel, `gw:42`, so only WS Gateway #42 receives the message.
5. WS Gateway #42 pushes it to Client B over B's socket.

When the recipient is offline, the message is written to `inbox_queue` as an undelivered row instead, and APNs / FCM sends a mobile push. When B reconnects, the gateway drains that backlog to the client, B acks, and the rows are deleted.

---
