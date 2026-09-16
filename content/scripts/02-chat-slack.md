# Chat / Slack — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design a chat app — think WhatsApp or Slack.

@you
Those two are quite different products, so let me narrow it before I design anything.

1. 1:1 only, or groups too — and how big can a group get?
2. What does "delivered" mean to the user? Do we need sent, delivered and read receipts?
3. What happens when the recipient is offline — push notification, and they catch up on reconnect?
4. Presence, history, search, voice and video — which of those are in?

@interviewer
1:1 and groups, and a Slack channel can be tens of thousands of people. Receipts, yes. Offline users get a push and catch up when they reconnect. Presence and history are in. Leave out calls.

@you
Then here's what I'm building, and what I'm not.

**Functional:** 1:1 and group messaging; real-time delivery to online users; offline users receive everything on reconnect; receipts that go sent → delivered → read; presence; message history with pagination.

**Non-functional:** delivery p99 under 500ms for online users. **Messages are never lost** — durable before we ack. Ordering is consistent *within a conversation*; I'm explicitly not promising a global order across conversations, because nobody can observe it and it would cost a single sequencer. Availability over global consistency.

**Out of scope, deliberately:** voice and video, file transfer specifics, and search. And end-to-end encryption key exchange — I'll mention where it would change the design, because it removes server-side features rather than just adding security.

@interviewer
Okay. Scale?

@you
Let me estimate, because I think the interesting number here isn't the message rate.

@note · Playbook 10.1, phase 1
"Ordering within a conversation, not globally" is a scope cut disguised as a requirement. Saying which ordering you *won't* provide, and why nobody would notice, is what stops you from designing a global sequencer by accident.

## Estimate · 3 min · Numbers, and the tier that is its own problem

@you
Assumptions: 500M daily actives, and at peak 50M of them connected at once.

- **Messages:** 100B a day is ~1.2M/sec on average, and ~4M/sec at peak.
- **Storage:** ~200 bytes a message row, so ~20 TB a day. That's a wide-column store, append-heavy, read mostly by recency.
- **Connections:** a gateway node practically holds ~50k sockets — file descriptors and memory per socket — so 50M concurrent connections is **~1,000 gateway nodes**.

The conclusion I want to draw from that last line: **the gateway tier is its own scaling problem, separate from storage.** A thousand stateful nodes each holding someone's socket is a different kind of thing from a message store, so I'll draw it as its own tier and design its failure modes separately.

@interviewer
Why is 50k the ceiling per node?

@you
It's not a hard limit, it's where things start costing more than the node is worth. Every socket has kernel buffers and an entry in the event loop, plus whatever per-connection state the gateway keeps — auth context, subscriptions. At tens of kilobytes per connection, 50k sockets is a few gigabytes. More importantly, the blast radius: a node dying drops 50k clients who all reconnect at once, and I'd rather that be 0.1% of users than 1%.

@note · Playbook 10.1, phase 2
The message rate is impressive but ordinary — any partitioned store handles it. The number that changes the design is 1,000 gateways, because it's why a registry exists at all. Pick the estimate that forces a box onto the diagram.

## API and data model · 5 min · A socket for the live path, and one partition per conversation

@you
A WebSocket for the live path, REST for everything that isn't live.

- `WS wss://chat.example.com/connect` — auth token in the handshake. The client sends `{type: "send", client_msg_id, conv_id, body}`; the server pushes `message`, `receipt` and `presence` frames.
- `GET /v1/conversations?cursor=` — my conversation list.
- `GET /v1/conversations/{id}/messages?cursor=&limit=50` — history, paged by `message_id`.
- `POST /v1/conversations {member_ids[]}` → `conversation_id`.
- `POST /v1/conversations/{id}/read {up_to_msg_id}` — read receipts.

The field that matters most is `client_msg_id`, a UUID the client generates. I'll come back to it.

@you · at the whiteboard
Four tables:

| Table | Key | The point |
|---|---|---|
| `messages` | PK `conversation_id`, SK `message_id` DESC (Snowflake) | one partition per conversation is one ordered log, and "latest 50" is a single range read |
| `conversations` | PK `conversation_id` | `type`, `member_count`, `last_message_id` |
| `members` | PK `user_id`, SK `conversation_id` | `last_read_msg_id`, `muted` — my conversation list and unread counts |
| `inbox_queue` | PK `user_id`, SK `message_id` | undelivered messages only; rows deleted on ack |

@interviewer
What defines the order of messages?

@you
The server-assigned Snowflake `message_id`, never the client's timestamp. Client clocks lie and networks reorder. Every message in a conversation shares a partition key, so they sit in one sorted log, and clients sort by `message_id`. The ID is monotonic per conversation, which is all I promised.

@interviewer
And receipts — a read flag on every message?

@you
No — one pointer. `last_read_msg_id` per user per conversation. Marking fifty messages read is one row update, not fifty. The unread count is messages with an ID above that pointer, which is a bounded range scan, or a cached counter I bump on send and reset on read.

@note · Playbook 10.1, phase 3
Two keys carry the design: the partition that makes a conversation an ordered log, and the pointer that makes receipts one write. Say the key and what it buys, not just the column list.

## High-level design · 10 min · Durable, then ack, then find the gateway

@you · drawing
Two stateful gateways with a stateless chat service between them. Let me trace Alice sending to Bob, who's online.

1. Alice's client holds a WSS connection to **gateway #17**. It sends the frame with a `client_msg_id`.
2. The gateway forwards it to the **chat service**, which validates and authorizes it, assigns a Snowflake `message_id`, and dedupes on `client_msg_id`.
3. It writes the message into its conversation's partition in **Cassandra**.
4. **Only now** does it ack `sent` to Alice.
5. It looks Bob up in the **connection registry** — Redis, `user_id → gateway node`, with a TTL refreshed by heartbeats. Bob is on gateway #42.
6. It publishes to the pub/sub channel **`gw:42`**, so only that one node receives it, and gateway #42 pushes it down Bob's socket.

Step 4's position is the whole durability guarantee. If I acked at the gateway and the gateway died before the write, Alice would see a checkmark next to a message that doesn't exist. Never ack before durable.

@you
Now Bob's offline. The registry has no entry, so instead of publishing, the chat service writes a row to **`inbox_queue`** and triggers a push through **APNs or FCM**. When Bob reconnects, his gateway drains his inbox rows, Bob's client acks them, and the rows are deleted.

@interviewer
Why the registry? Just publish every message to all gateways and let the one holding Bob deliver it.

@you
Because that's a thousand-times write amplification on the pub/sub layer. Every one of 4M messages a second would go to every gateway, and 999 of them would throw it away. The registry turns a broadcast into a targeted publish.

The cost is an extra Redis lookup per message and a consistency window when Bob reconnects to a different node. That window is safe: a stale entry means we publish to a gateway that no longer has his socket, it finds nothing, and the message falls through to the offline path. The TTL bounds how long that can happen.

@interviewer
A mobile client on a train sends, loses signal before the ack, and retries. What happens?

@you
It retries with the same `client_msg_id`, and the chat service dedupes on it, returning the original `message_id` instead of creating a second message. That's the single most important detail in mobile chat — without it, every tunnel produces a duplicate.

And the gateways being stateful — I know that breaks the stateless ideal. I'd accept it and contain it: a gateway holds **only** the socket. Everything durable lives elsewhere, so a gateway dying just means its clients reconnect and re-register.

@note · Playbook 10.1, phase 4
When an interviewer proposes the simpler design, give the multiplier that rules it out — "1,000x write amplification" — then name what your choice costs and why that cost is safe. The stale-registry answer is where most candidates wave their hands.

## Deep dive · 15 min · Offline delivery, groups, and the parts that fan out

@you
I see two hard parts: routing and offline delivery — making sure nothing is lost across reconnects — and group fan-out, which is the celebrity problem again for big channels. Presence is a third that's more expensive than it looks. Where would you like me to start?

@interviewer
Start with a client on a flaky network that misses pushes.

@you
Then I'd make the client, not the inbox, the source of truth for what it's missing. Each client tracks the **highest `message_id` it has received per conversation**. On reconnect it sends those cursors, and the server replies with everything after each one, paged from the messages store.

That's more robust than the inbox queue alone. The inbox only knows about messages we *decided* were undelivered; the cursor catches everything — a pub/sub publish that was dropped, a gateway that died between receiving the publish and writing to the socket, a registry entry that was stale. Pub/sub becomes a doorbell rather than a delivery guarantee.

@interviewer
So how do you guarantee a message is displayed exactly once?

@you
I don't guarantee exactly-once delivery — nothing across a network can. I guarantee **at-least-once delivery plus idempotent rendering**. The client dedupes on `message_id`, so a message that arrives by push and again by cursor sync renders once. The server dedupes sends on `client_msg_id`. Between those two keys, duplicates are invisible in both directions.

@interviewer
Multiple devices — phone and laptop?

@you
The registry maps `user_id` to a **list** of connections, not one. We deliver to all of them. Read state lives server-side in `last_read_msg_id`, so reading on the laptop moves the pointer and the phone's unread badge converges on its next sync. Each device keeps its own cursors, so a device that was off for a week catches up independently.

@you
Now groups. For a small group — a family chat, a team of eight — the chat service looks up the members and delivers to each, exactly like 1:1. A 50,000-member Slack channel is the celebrity problem: one message is 50k registry lookups and publishes, and most of those members don't have the channel open.

So the same hybrid as a feed:

| Channel size | Delivery |
|---|---|
| Small | push to every member through the registry |
| Very large | clients **with the channel open** subscribe to a channel-level topic and get it live; everyone else pulls on open and sees an unread marker |

The unread badge for a big channel doesn't need the message itself, just that `last_message_id` moved past their `last_read_msg_id`.

@interviewer
Doesn't a busy channel become a hot partition?

@you
Yes — a partition per conversation is unbounded for a channel that's been busy for years. I'd bucket the key: `PK = (conversation_id, time_bucket)`, say a bucket per week or per N messages. Reads for recent history hit the newest bucket, which is almost every read, and scrolling back walks buckets in order.

@you
Presence, briefly, because it's the most over-engineered part of most chat designs. Naively, every status change is broadcast to everyone who might care — for a user in forty groups, that's a fan-out on every tab switch. I'd compute presence only for conversations the user **has open**, batch updates every few seconds, and treat it as lossy and best-effort. Nobody is harmed by a green dot that's five seconds late.

@interviewer
Editing and deleting messages?

@you
Append, don't mutate. An edit or a delete is a new event in the conversation that references the original `message_id`, and clients apply it. Mutating history in place breaks the append-only model — a client that synced the original by cursor would never learn it changed. As an event, it arrives through exactly the same path as a message.

And if we ever add end-to-end encryption, the server stores ciphertext only, which means no server-side search, no previews in push notifications, no moderation. It removes features, not just adds security, so it's a product decision.

@note · Playbook 10.1, phase 5
Offering a choice of three and letting the interviewer pick is confident. Notice how many follow-ups resolved to the same two keys — `client_msg_id` on the way in, `message_id` on the way out. Depth is going three levels into one mechanism, not touring more boxes.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
The first thing that breaks isn't storage — it's **connection establishment**. A deploy or a gateway failure drops tens of thousands of sockets that all reconnect in the same second, and a thundering herd of TLS handshakes and registry writes can take out the tier that's meant to absorb them. Clients reconnect with **jittered exponential backoff**, deploys drain nodes gradually, and the tier autoscales on connection count behind an L4 balancer.

At 10x — 500M sockets, 10,000 gateways — a few more things change:

1. **Regional gateways.** A socket held across an ocean adds ~150ms to every frame, so each region runs its own fleet.
2. **Heartbeats move from users to gateways.** 500M entries on a 30-second TTL is ~17M registry writes a second just to stay alive. Instead each entry records its gateway's lease epoch, and one gateway lease expiring invalidates every entry that points at it.
3. **`inbox_queue` goes away.** Writing a row for every undelivered message nearly doubles writes on the hottest path. Cursor sync, which already works, becomes the only offline path.
4. **Tiered storage** for buckets older than ~30 days, because 200 TB a day on hot nodes is the bill and almost every read is recent.

@you
What I'd monitor: p99 delivery latency, measured from ack to recipient's socket; **reconnect rate per gateway**, because a spike is either a bad deploy or a network event and it precedes a storm; registry misses that turn out to be online users, which measures staleness; push provider error and throttle rates; and cursor-sync gap sizes on reconnect — if clients routinely recover large gaps, pub/sub is dropping more than it should.

@interviewer
Last one. How would you add search?

@you
As a completely separate path. **CDC from the messages store into Elasticsearch**, with an index per workspace so a tenant's search never scans another's data and a big customer can be isolated. Never search the primary store — it's partitioned for "latest in this conversation," which is the opposite of full-text across everything. The cost is that search lags writes by a few seconds, which nobody notices.

@you
To close: this design is a message store partitioned so each conversation is an ordered log, a thousand stateful gateways that hold nothing but sockets, and a registry that turns a broadcast into a targeted publish. What makes it correct rather than just fast is durable-before-ack, `client_msg_id` dedupe on the way in, and cursor sync on the way out — which together mean a lost push is a delay, never a lost message.

@note · Playbook 10.5
Leading with reconnect storms rather than storage shows you've operated stateful fleets, not just drawn them. And the closing sentence ties every mechanism back to the one requirement that mattered — never lose a message — which is what the interviewer will write down.
