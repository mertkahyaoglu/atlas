---
group: "design"
order: 16
title: "Researcher–Participant Chat"
summary: "Two strangers, one of them anonymous, allowed to talk only while a study says so, at a scale where the hard part is policy rather than throughput."
hardPart: "Scale is easy. The hard part is authorization the chat service doesn't own: study lifecycle, a participant who must stay anonymous, and staff who must see everything without becoming the leak."
tags: ["realtime", "security", "rate-limiting", "outbox", "postgres"]
hardPartDetail: "Scale is **not** the problem: one Postgres primary and three gateway nodes carry it. The hard part is authorization that depends on things the chat service doesn't own: the study's lifecycle state, a participant who must stay anonymous to the researcher yet be identifiable to support through an audited path, and trust between strangers (rate limits, reports, blocks). Candidates who spend thirty minutes on WebSocket fan-out and Cassandra partitioning are solving the wrong problem."
concepts:
  - "right-sizing (no over-engineering)"
  - "study-lifecycle access gating"
  - "asymmetric pseudonymity"
  - "audited break-glass access"
  - "durable before ack"
  - "transactional outbox"
  - "rate limiting and moderation"
  - "presigned uploads + quarantine"
  - "GDPR retention and erasure"
requirements:
  functional:
    - "1:1 messaging between a researcher and a participant, scoped to a specific study"
    - "A conversation is the unique `(study, researcher, participant)` triple, not an open-ended thread"
    - "Persistent message history with paginated retrieval"
    - "Real-time delivery when both are online; email or push notification when offline"
    - "Delivery and read receipts"
    - "Attachments"
    - "Report or block the other party"
    - "Support staff can view conversations to resolve disputes"
  nonFunctional:
    - "Moderate scale: tens of thousands of concurrent connections, low hundreds of messages/sec at peak. **Don't over-engineer.**"
    - "Never lose a message (durable before ack); typing indicators and presence may be lossy"
    - "UK GDPR: chats contain PII, so retention limits and the right to erasure are enforced by the system"
    - "Participant identity is masked from the researcher unless revealed through an audited path"
    - "Abuse resistance is first-class: rate limits, reporting and moderation are part of the send path"
    - "Access is gated by study lifecycle state, not just by whether two users may talk"
  outOfScope:
    - "Group chat"
    - "End-to-end encryption (it would blind support and moderation, so say why it's excluded)"
    - "Message search"
    - "Typing indicators beyond a mention"
    - "Multi-region deployment"
    - "Voice and video"
scale:
  numbers: |-
    Participants: ~200k monthly active · researchers: ~10k
    Concurrent connections: ~30k at peak (participants mid-study + open dashboards)
    Messages: ~2M/day → ~25/sec avg, ~200/sec peak
    Message row ~0.5 KB → ~1 GB/day → ~400 GB kept under a 12-month retention cap
    Attachments: ~1% of messages × ~1 MB → ~20 GB/day, object storage, not the DB
    Gateways: 30k sockets ÷ ~10k per node (well under the ~50k ceiling) → 3 nodes, N+1
  conclusion: "Every number fits one Postgres primary, one Redis and three gateway nodes: about **20,000x less** write load than the Slack design. Say that out loud, then spend the saved time on the actual hard parts: who may talk when, who may see whom, and how long anything is kept."
tradeoffs:
  - title: "Right-size it before anything else"
    body: |-
      Peak load is ~200 messages/sec. One Postgres primary absorbs that with room to spare, and a relational store fits the access pattern: every send is an authorization check across conversation state and blocks, followed by an insert, all in one transaction.

      Deliberately *not* in this design: Cassandra, Kafka, a Snowflake ID service, a connection registry, sharding. Each is defensible at 1,000x the traffic and pure overhead here. The sentence that scores: *"I'd keep the schema shardable by `study_id`, but I wouldn't shard on day one."*

      Two choices that are about correctness rather than scale. Run a **synchronous standby**, because failing over to an async replica can drop messages that were already acked, which is the one loss the requirements forbid. And batch retention deletes so they never compete with live sends.
  - title: "The conversation is a natural key"
    body: |-
      `UNIQUE (study_id, researcher_id, participant_id)` makes opening a conversation an upsert (`INSERT … ON CONFLICT DO NOTHING`, then read the row). Two tabs clicking *Message participant* at once converge on one row, so there's no find-or-create race and no duplicate threads to merge later.

      It also settles scoping for free. A researcher who works with the same participant in two studies gets two conversations with two different aliases, and access rules follow each study independently. The researcher never sends a `participant_id` at all: they open a chat from a submission, and the server resolves the triple.
  - title: "Study-state gating: materialize it, don't call out per message"
    body: |-
      The Study service owns the lifecycle, but chat shouldn't go down whenever it does. Instead of calling it on every send, chat consumes its lifecycle events and stores the result on the conversation row, so the gate is a column read inside the send transaction.

      | Lifecycle event | Conversation change | Who can send |
      |---|---|---|
      | Participant invited, or submission started | `state = open` | both |
      | Study completed | `writable_until = now + 30 days` | both, until the dispute window ends |
      | Report under review | `state = frozen` | support only |
      | Retention deadline passes | bodies purged, row kept as a tombstone | nobody |

      Gate on the *pair*, not just the study: a study can still be active while this participant's submission is already approved. The dispute window is a timestamp checked at send time, so no job has to flip it.

      Events arrive late, twice or out of order, so every update is guarded with `WHERE study_version < $event_version`, and a replayed old event can never reopen a closed conversation. The cost is a few seconds of staleness after a closure, which is harmless. Chat failing whenever the Study service fails is not.
  - title: "Anonymity is asymmetric, enforced at one boundary"
    body: |-
      The researcher sees a random alias (`Participant 7Q3K`) generated when the conversation is created and stored on its row. Each conversation gets its own alias, so a researcher can't correlate one participant across studies through chat. The participant sees the researcher's verified workspace name: researchers are the accountable, paying side, so the asymmetry is deliberate. Whether individual research assistants are named is a product decision; default to the workspace.

      Enforce masking at one choke point: a role-aware serializer that every researcher-facing payload passes through (REST responses, WebSocket frames, notification emails), with a test that fails if `participant_id` ever appears. Masking sprinkled across handlers leaks the first time someone adds an endpoint.

      The leak you can't close is content. Participants can type their email address, and photos carry GPS coordinates in EXIF. Strip metadata on upload and nudge before sending contact details. The system guarantees the *platform* never reveals identity, not that users won't.
  - title: "Staff access is break-glass, not a query"
    body: |-
      Support needs full history to resolve disputes, and occasionally needs to know who is behind an alias (safeguarding, fraud, a legal request). Treat both as exceptional:

      - **Ticket-scoped reads.** Staff open conversations linked to a dispute or report. There is no search box over every chat.
      - **Audit first, then read.** The audit row is written before any data is returned, and if that write fails, the read fails. This is the one place the design picks consistency over availability, and it's worth saying so.
      - **Four-eyes unmasking.** Revealing identity requires a reason and a second approver. Revealing it *to the researcher* also notifies the participant.
      - **Tamper-resistant log.** The service's database role can only `INSERT` into `audit_log`, and rows are shipped to write-once storage, so an insider can't erase their own trail.

      You can't stop an authorized reader from taking notes. You can make every read attributable, reviewed by someone outside support, and alerted on when the volume looks unusual.
  - title: "Durable before ack, receipts as pointers"
    body: |-
      One transaction per send: check the gate, insert the message, insert an outbox row, commit, and only then ack `sent` with the server-assigned `message_id`. Mobile retries reuse `client_msg_id`, and `UNIQUE (conversation_id, client_msg_id)` hands back the original message instead of creating a duplicate.

      IDs come from a plain Postgres sequence. With a single writer there's nothing to coordinate, so there's no Snowflake service, and ordering within a conversation is just `ORDER BY message_id`.

      Receipts are two pointers per side, `last_delivered_msg_id` and `last_read_msg_id`, updated with `GREATEST(...)` so they only ever move forward. Read receipts are personal data too, since they reveal when someone was active, so they're a per-user setting.
  - title: "Real-time: per-user channels, no connection registry"
    body: |-
      Three gateway nodes hold sockets and nothing else. When a gateway accepts a connection it subscribes to the Redis channel `user:<id>`. After commit, the chat service publishes to the recipient's channel, and Redis delivers only to the gateway holding that socket. With ~30k online users on one Redis, the subscriptions *are* the routing table. The explicit registry in the Slack design earns its keep with a thousand gateways, not three.

      Pub/sub is a doorbell, not a delivery guarantee. If a publish is missed because a gateway restarted or a socket flapped, the client reconnects with its last `message_id` per conversation and pages the gap from Postgres.

      WebSockets aren't mandatory at this scale. Server-Sent Events for incoming messages plus ordinary POSTs for sends would also work, reusing normal HTTP auth, rate limiting and proxies. Either is defensible, and saying so is the signal.
  - title: "Offline delivery is a debounced outbox"
    body: |-
      The outbox row commits with the message, so a crash between saving and notifying can't lose the notification (no dual write). A worker claims due rows with `FOR UPDATE SKIP LOCKED` after a short delay, then checks before sending:

      - Already read (`last_read_msg_id >= message_id`) or still connected: drop it.
      - More messages in the same conversation inside the window: send one notification, *3 new messages about 'Sleep study'*.

      The email contains **no message content**, only a link. Once text lands in someone's inbox it's beyond retention and erasure control, and the email provider becomes a processor of research data. Delivery is at-least-once; an occasional duplicate email is the accepted cost.
  - title: "Abuse controls live on the server's send path"
    body: |-
      Researchers and participants are strangers and money is involved, so assume someone is hostile:

      - **Rate limits** as Redis token buckets (see the rate limiter design): per sender per conversation, per sender overall, and a daily cap on *new* conversations per researcher, because mass cold outreach is the spam pattern. New accounts get tighter buckets.
      - **Blocks** are rows checked inside the send transaction; a client-side hide is not a block. The blocked side sees a neutral "conversation closed", which avoids provoking retaliation.
      - **Reports** snapshot the reported messages into the moderation case and set `legal_hold`, so the reported party can't delete the evidence and retention can't purge it mid-investigation. Severe categories freeze the conversation immediately.
      - **Content checks** split by cost. Cheap synchronous ones (contact details, known-bad URLs) run inline; slower classifiers run asynchronously and flag for review, never adding latency to a send.
  - title: "Attachments: presigned, quarantined, scanned"
    body: |-
      The client asks for an upload URL. The server applies the same gate as a send (conversation open, not blocked, under limits) plus a type allowlist and a size cap, then returns a presigned `PUT` into a quarantine prefix. The bytes never touch the app servers.

      An object-created event triggers the scan: antivirus, content-type sniffing from magic bytes rather than the file extension, and EXIF stripping. Only a clean file is attached to the message. Downloads use short-lived presigned `GET` URLs minted per request after authorization, so a block, freeze or purge takes effect immediately, with no permanent links left to revoke.
  - title: "GDPR: retention, erasure and legal hold"
    body: |-
      **Retention.** When a conversation's dispute window ends, set `retention_deadline` (say 12 months later). A nightly job, batched and rate limited, nulls message bodies and deletes attachment objects past the deadline unless `legal_hold` is set. Rows stay as tombstones so receipts and audit references remain valid.

      **Erasure.** A deletion request removes the requester's message bodies and attachments and leaves "message deleted" tombstones, so the other party's history still reads coherently. It isn't absolute: an open dispute or safeguarding report can justify keeping evidence under the legal-claims exemption, which is exactly what `legal_hold` records.

      **Copies.** Every copy is one more thing to erase. Don't send message bodies to analytics or a search index. Backups can't be edited, so keep their retention short and replay an erasure ledger after any restore, or encrypt attachments with per-conversation keys and delete the key (crypto-shredding).

      **Residency.** One UK region for the database, Redis and the attachment bucket. For this company, single-region is a compliance feature rather than a limitation.
followUps:
  - question: "Why not buy a chat SaaS (Sendbird, Stream, Twilio)?"
    answer: "At this scale it's a legitimate answer, and offering it scores. But study-state gating, alias masking, audited staff access, retention and erasure stay in your code either way, and every message now flows through a third-party processor that needs a data processing agreement, UK hosting and deletion guarantees. Buying removes the easy part (sockets), not the hard part."
  - question: "A participant hits send at the exact moment the dispute window closes. What happens?"
    answer: "The gate and the insert share one transaction, so the message is either stored while `writable_until` was still in the future, or rejected with a 409 carrying a reason the client can show ('chat for this study has closed'). The draft stays on the client, and support can reopen the conversation if there's a genuine dispute."
  - question: "Someone on the support team wants to browse one participant's chats. What stops them?"
    answer: "No endpoint allows it. Staff reads are scoped to conversations linked to a ticket, there's no free-text search across chats, and every read is written to the audit log before data is returned. Access volume per staff member is alerted on, and the log is reviewed by someone outside support. An authorized reader can still take notes, so the goal is that every read is attributable and rare."
  - question: "Could you drop Redis and use Postgres LISTEN/NOTIFY?"
    answer: "At three gateways, plausibly, and NOTIFY only fires on commit, which is a nice property. The costs: payloads are capped at 8 KB, listeners need dedicated connections that don't work through transaction-pooling PgBouncer, and notifications sent while a listener is disconnected are simply gone, which the cursor resync repairs anyway. Redis stays because the rate-limit buckets already need it."
  - question: "A participant pastes their email address into the chat. Is anonymity broken?"
    answer: "Yes, and no system can prevent voluntary disclosure. It can make disclosure deliberate: detect emails, phone numbers and social handles before sending and ask for confirmation, strip EXIF from images, and flag researchers who repeatedly ask for contact details, since that breaks platform policy and moderation should see it."
  - question: "What if Redis drops a publish, or a gateway dies mid-conversation?"
    answer: "Nothing is lost, because the message was committed before anyone was told. Clients reconnect with jittered backoff, send the highest `message_id` they hold per open conversation, and page everything after it from Postgres. At-least-once delivery plus client-side dedupe on `message_id`, same as the Slack design."
  - question: "What breaks first at 10x?"
    answer: "Not Postgres: 2,000 messages/sec is still comfortable, and gateways scale out. The first thing to break is human moderation, because reports grow with users and reviewers don't autoscale, so severity triage and classifier-assisted queues come before any database work. Second is the retention and erasure jobs competing with live traffic, which is when partitioning messages so old data can be dropped in bulk starts paying for itself."
---
# 16 — Researcher–Participant Chat (Prolific-style)

## API / Model

```api
# WebSocket · session checked in the handshake
WS wss://chat.example.com/connect || || 101
+ → client sends: {type:"send", client_msg_id, conversation_id, body, attachment_ids[]}
+ → client sends: {type:"read", conversation_id, up_to_msg_id}
+ ← server sends: {type:"message"|"receipt"|"state", ...}
# REST · conversations and history
POST /v1/conversations || {study_id, submission_id} || 201 200 conversation_id, alias || upsert on the (study, researcher, participant) triple; nobody sends a participant_id
GET /v1/conversations?cursor= || || 200 conversation list || researcher-facing payloads carry aliases only
GET /v1/conversations/{id}/messages?before=&limit=50 || || 200 message page || ?after={message_id} for reconnect resync
POST /v1/conversations/{id}/messages || {client_msg_id, body, attachment_ids[]} || 201 409 429 message_id || socket fallback; 409 when the conversation isn't writable
POST /v1/conversations/{id}/attachments || {filename, content_type, size} || 201 attachment_id, upload_url || presigned PUT into quarantine
# Safety
POST /v1/conversations/{id}/report || {reason, message_ids[]} || 201 report_id || snapshots evidence, sets legal_hold
POST /v1/conversations/{id}/block || || 204
# Staff · separate service, support role only, every call audited
GET /staff/v1/tickets/{ticket_id}/conversations/{id} || || 200 403 full history || only conversations linked to the ticket
POST /staff/v1/conversations/{id}/unmask || {ticket_id, reason, approver_id} || 200 403 participant identity || four-eyes; audit row written before the response
```

All of it lives in one Postgres primary with a synchronous standby.

```erd
# Access and safety · who may send, who may see
conversations || the triple is the identity; state is materialized from lifecycle events
+ conversation_id || bigint || PK
+ study_id || uuid
+ researcher_id || uuid
+ participant_id || uuid
+ participant_alias || text
+ state || open | frozen
+ writable_until || timestamptz || null
+ study_version || bigint
+ retention_deadline || timestamptz || null
+ legal_hold || boolean
+ UNIQUE (study_id, researcher_id, participant_id)
blocks || checked inside the send transaction
+ conversation_id || bigint || PK → conversations
+ blocker_role || role || PK
+ created_at || timestamptz
reports || opening a report sets legal_hold
+ report_id || bigint || PK
+ conversation_id || bigint || → conversations
+ reporter_role || role
+ category || text
+ evidence_snapshot || jsonb
+ status || text
audit_log || INSERT-only grant; shipped to write-once storage
+ audit_id || bigint || PK
+ actor_id || uuid
+ ticket_id || uuid
+ conversation_id || bigint || → conversations
+ action || view | unmask
+ reason || text
+ created_at || timestamptz
# Messages and delivery
messages || message_id from a sequence: one writer, no Snowflake needed
+ conversation_id || bigint || PK → conversations
+ message_id || bigint || PK
+ client_msg_id || uuid
+ sender_role || role
+ body || text || null
+ attachment_id || bigint || null → attachments
+ created_at || timestamptz
+ erased_at || timestamptz || null
+ UNIQUE (conversation_id, client_msg_id)
attachments || bytes live in object storage; download URLs minted per request
+ attachment_id || bigint || PK
+ conversation_id || bigint || → conversations
+ object_key || text
+ content_type || text
+ size || bigint
+ status || quarantined | clean | rejected
receipts || two rows per conversation; pointers only move forward
+ conversation_id || bigint || PK → conversations
+ role || role || PK
+ last_delivered_msg_id || bigint || null → messages.message_id
+ last_read_msg_id || bigint || null → messages.message_id
notification_outbox || committed with the message; the worker debounces
+ outbox_id || bigint || PK
+ recipient_id || uuid
+ conversation_id || bigint || → conversations
+ message_id || bigint || → messages.message_id
+ not_before || timestamptz
+ sent_at || timestamptz || null
```

Two columns on `conversations` carry most of the design. The `(study_id, researcher_id, participant_id)` triple is the identity, which makes creation idempotent and scopes every rule to one study. `state` plus `writable_until` is the gate every send passes through, in the same transaction as the insert.

---

## High-level architecture

<!-- tab: Today · ~200 msg/s -->

```mermaid
flowchart TB
    P([Participant]) -- "WSS · send" --> GWA["WS gateway #1<br/>sender's socket"]
    GWA -- "1 · send frame" --> Limit

    subgraph SEND ["Chat service"]
        direction TB
        Limit["2 · rate limit<br/>Redis bucket, else 429"]
        Gate["3 · BEGIN · gate, else 409<br/>conversation open<br/>before writable_until<br/>not blocked"]
        Write["insert message<br/>+ outbox row<br/>dedupe on client_msg_id"]
        Ack["COMMIT, then ack sent"]
        Limit --> Gate --> Write --> Ack
    end

    Study["Study service<br/>owns study state"] -. "lifecycle events" .-> Consumer["Lifecycle consumer<br/>study_version guard"]
    Consumer --> PG
    Write --> PG[("Postgres · truth<br/>sync standby<br/>messages · outbox<br/>audit_log")]

    Ack -- "4 · publish" --> Redis{{"Redis<br/>pub/sub doorbell<br/>rate-limit buckets"}}
    Redis -- "5 · push" --> GWB["WS gateway #3<br/>recipient's socket"]
    GWB -- "WSS · alias only" --> R([Researcher])

    PG --> Notifier["Notifier worker<br/>skip if read · debounce"]
    Notifier --> Email["Email / push<br/>link only, no body"]

    Staff["Staff console<br/>ticket-scoped reads<br/>four-eyes unmask"] -- "audit row, then read" --> PG
    Retention["Retention + erasure<br/>honours legal_hold"] --> PG
    Retention --> Obj[("Object storage<br/>presigned PUT<br/>quarantine → scan")]

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class PG db
    class Obj blob
    class Gate,Staff hot
    class Redis queue

    click GWA href "/docs/07-apis-and-communication" "Role: holds the sender's socket and forwards frames to the chat service.<br/>Trade-off: stateful, but three nodes with a spare is the whole scaling story here."
    click Limit href "/docs/07-apis-and-communication" "Role: rejects a sender whose token bucket is empty, before any database work.<br/>Trade-off: one Redis round trip per send, and a Redis outage forces a fail-open or fail-closed choice."
    click Gate href "/docs/03-consistency-and-distributed-systems" "Role: checks conversation state and blocks inside the send transaction, before the insert.<br/>Trade-off: state is materialized from events, so a study closure lands a few seconds late."
    click PG href "/docs/02-data-storage" "Role: source of truth for conversations, messages, the outbox and the audit log.<br/>Trade-off: the synchronous standby adds a little commit latency so failover never loses an acked message."
    click Redis href "/docs/05-async-messaging-and-event-driven" "Role: rings the recipient's gateway after commit and holds rate-limit buckets.<br/>Trade-off: pub/sub drops publishes nobody hears, so clients resync from Postgres on reconnect."
    click Consumer href "/docs/05-async-messaging-and-event-driven" "Role: turns study lifecycle events into conversation state.<br/>Trade-off: events repeat and reorder, so every update is guarded by study_version."
    click Notifier href "/docs/03-consistency-and-distributed-systems" "Role: drains the transactional outbox into debounced email and push.<br/>Trade-off: at-least-once, so a crash mid-send can produce a duplicate email."
    click Obj href "/docs/09-specialized-building-blocks" "Role: attachment bytes, quarantined until scanned and served through short-lived URLs.<br/>Trade-off: scanning delays an attachment's appearance by a few seconds."
    click Staff href "/docs/08-reliability-and-operations" "Role: ticket-scoped support access and audited unmasking.<br/>Trade-off: reads fail closed if the audit write fails, choosing consistency over availability."
    click Retention href "/docs/08-reliability-and-operations" "Role: enforces retention deadlines and erasure requests.<br/>Trade-off: backups can't be edited, so erasure is replayed after restores or keys are shredded."
```

Everything durable lives in Postgres. The WS gateways hold sockets, Redis rings the recipient's gateway and holds rate-limit buckets, and the remaining boxes are side flows that read or write the same database.

1. The participant sends a frame over WSS to WS gateway #1, which forwards it to the Chat service.
2. The Chat service checks the sender's token bucket in Redis and rejects the send with 429 if it's empty, before any database work.
3. Inside one transaction, the gate rejects the send with 409 unless the conversation is open, still before `writable_until`, and not blocked. Otherwise the service inserts the message and a `notification_outbox` row, deduping on `client_msg_id`, commits, and only then acks `sent` to the participant with the new `message_id`.
4. It publishes to the recipient's Redis channel, `user:<id>`.
5. Redis delivers the publish to the subscribed gateway, WS gateway #3, which pushes the message to the researcher over WSS with the participant's alias only.

The side flows all meet at Postgres. The lifecycle consumer applies study service events to conversation state, guarded by `study_version`. The notifier worker drains the outbox into an email or push that carries a link but no message body. The staff console writes an audit row before each ticket-scoped read. Retention + erasure clears expired message bodies and attachment objects unless `legal_hold` is set, and attachments reach object storage through a presigned PUT into quarantine.

<!-- tab: At 100x · ~20k msg/s -->

```mermaid
flowchart TB
    P([Participant]) -- "WSS" --> LB["L4 load balancer<br/>long-lived connections"]
    LB --> GWA["WS gateway fleet<br/>~100 nodes · ~30k sockets each"]
    GWA -- "1 · send frame" --> Limit

    subgraph SEND ["Chat service · stateless"]
        direction TB
        Limit["2 · rate limit<br/>dedicated Redis Cluster"]
        Txn["3 · route by shard bits in conversation_id<br/>BEGIN · gate · insert encrypted message<br/>+ outbox · COMMIT, then ack sent"]
        Limit --> Txn
    end

    Txn --> Shards[("Postgres · 64 logical shards<br/>keyed by study_id<br/>primary + sync standby each<br/>monthly message partitions")]
    Txn -- "4 · lookup" --> Registry[("Connection registry<br/>user_id → gateways<br/>TTL heartbeat")]
    Txn -- "5 · publish" --> PubSub{{"pub/sub<br/>channel per gateway"}}
    PubSub -- "6 · push" --> GWB["WS gateway #57<br/>recipient's socket"]
    GWB -- "WSS · alias only" --> R([Researcher])

    Study["Study service"] -. "lifecycle events<br/>keyed by study_id" .-> Consumer["Lifecycle consumer<br/>study_version guard"]
    Consumer --> Shards

    Shards -- "outbox · CDC" --> Kafka{{"Kafka · chat events<br/>keyed by conversation_id<br/>ids, no bodies"}}
    Kafka --> Notifier["Notifier<br/>skip if read or connected<br/>link only, no body"]
    Kafka --> Inbox[("Inbox index<br/>sharded by user_id")]
    Kafka --> Mod["Moderation pipeline<br/>classifiers → severity triage<br/>reviewer queues"]

    %% Side flows sit below the stream so the diagram grows down, not across.
    Inbox ~~~ Staff
    Mod ~~~ Retention

    Shards -. "ticket-scoped read" .-> Staff["Staff console<br/>audit row, then read<br/>four-eyes unmask"]
    Staff -- "audit row first" --> Audit[("Audit store<br/>INSERT-only → WORM")]

    Shards -. "past deadline" .-> Retention["Retention + erasure<br/>shred keys · drop partitions"]
    Retention --> Keys[("Key store<br/>data key per<br/>conversation side")]
    Retention --> Obj[("Object storage · UK<br/>quarantine → scan")]

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef lb fill:#5d3759,stroke:#e066b2,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    classDef scaled stroke-dasharray:5 3
    class Shards,Inbox,Audit,Keys db
    class Registry cache
    class Obj blob
    class Kafka,PubSub queue
    class LB lb
    class Txn,Staff hot
    class LB,GWA,Registry,PubSub,Shards,Kafka,Inbox,Mod,Audit,Keys scaled

    click LB href "/docs/01-foundations" "Role: spreads ~3M long-lived WebSocket connections across the gateway fleet.<br/>Trade-off: balancing happens per connection, so load only evens out as clients reconnect."
    click GWA href "/docs/07-apis-and-communication" "Role: socket-only nodes, autoscaled on connection count.<br/>Trade-off: kept well under the ~50k ceiling so a dead node's clients fit on its neighbours."
    click Limit href "/docs/07-apis-and-communication" "Role: token buckets per sender, per conversation and for new conversations.<br/>Trade-off: a Redis Cluster of its own, so registry churn in a reconnect storm can't stall sends."
    click Txn href "/docs/03-consistency-and-distributed-systems" "Role: routes to the shard named in conversation_id and runs the gate and insert as one local transaction.<br/>Trade-off: everything the gate reads must live with the conversation, which pins the shard key."
    click Shards href "/docs/02-data-storage" "Role: source of truth, split into 64 logical shards on a few physical primaries.<br/>Trade-off: no cross-shard queries, so conversation lists and erasure need the inbox index."
    click Registry href "/docs/07-apis-and-communication" "Role: maps each user to the gateways holding their sockets, one entry per device.<br/>Trade-off: entries go stale when a gateway dies; TTL heartbeats bound it and cursor resync covers the gap."
    click PubSub href "/docs/05-async-messaging-and-event-driven" "Role: rings only the gateways holding the recipient, not every node.<br/>Trade-off: still fire-and-forget, so clients resync from Postgres on reconnect."
    click Keys href "/docs/09-specialized-building-blocks" "Role: one data key per conversation side; deleting it erases those bodies everywhere.<br/>Trade-off: a dependency on every send and history read, softened by caching keys briefly."
    click Kafka href "/docs/05-async-messaging-and-event-driven" "Role: one ordered stream of send events for every async consumer.<br/>Trade-off: CDC lags by about a second, which is why the doorbell doesn't wait for it."
    click Notifier href "/docs/03-consistency-and-distributed-systems" "Role: turns send events into debounced email and push.<br/>Trade-off: at-least-once, so a crash mid-send can produce a duplicate email."
    click Inbox href "/docs/02-data-storage" "Role: each user's conversation list, and the map erasure uses to find their shards.<br/>Trade-off: built from the stream, so a new conversation can take a second to appear."
    click Mod href "/docs/08-reliability-and-operations" "Role: classifiers score messages and severity triage orders the reviewer queues.<br/>Trade-off: auto-freezing on confident severe hits can pause a legitimate chat until a human looks."
    click Consumer href "/docs/05-async-messaging-and-event-driven" "Role: applies study lifecycle events on the shard that owns the study.<br/>Trade-off: events still repeat and reorder, so every update keeps the study_version guard."
    click Staff href "/docs/08-reliability-and-operations" "Role: ticket-scoped support access and audited unmasking.<br/>Trade-off: the audit store is now a separate dependency, and reads fail closed when it's down."
    click Audit href "/docs/08-reliability-and-operations" "Role: append-only record of every staff read and unmask, shipped to write-once storage.<br/>Trade-off: it no longer shares a database with the data, so ordering (audit, then read) is the guarantee."
    click Retention href "/docs/08-reliability-and-operations" "Role: shreds keys at deadlines and on erasure requests, then drops expired partitions.<br/>Trade-off: rows under legal hold must be copied forward before a partition can go."
    click Obj href "/docs/09-specialized-building-blocks" "Role: attachment bytes, quarantined until scanned, with scan workers that autoscale.<br/>Trade-off: at ~2 TB/day a traffic spike builds a scan backlog, delaying attachments."
```

Same product and the same rules, at 100x the traffic. Dashed outlines mark what's new or reshaped compared with today's design; every other box is the same component doing the same job.

| | Today | At 100x |
|---|---|---|
| Concurrent connections | ~30k | ~3M |
| Messages at peak | ~200/sec | ~20k/sec |
| Database writes at peak, receipts included | ~600/sec | ~60k/sec |
| Message rows inside retention | ~400 GB | ~40 TB |
| Attachments | ~20 GB/day | ~2 TB/day |
| Gateway nodes | 3 | ~100 |

**What changes, and the number that forces it**

1. **Gateways: 3 nodes → ~100 behind an L4 load balancer.** 3M sockets at ~30k per node, deliberately below the ~50k ceiling so a dead node's clients fit on its neighbours when they reconnect. Reconnect storms after a deploy or an outage size this tier more than steady traffic does, so deploys drain a few nodes at a time and clients back off with jitter.
2. **Per-user channels → a connection registry.** Three million per-user subscriptions no longer sit comfortably on one Redis, and Redis Cluster's classic pub/sub broadcasts every publish to every node. The chat service looks up `user_id → gateways` in a TTL'd registry and publishes to each gateway's own channel, which is the Slack design's shape. The registry also answers questions that used to be free: which of a user's devices are online, and whether the notifier can skip an email because the recipient is connected. Rate-limit buckets move to a separate Redis Cluster so registry churn during a reconnect storm can't stall sends.
3. **One Postgres → 64 logical shards keyed by `study_id`.** ~20k inserts/sec would squeeze onto a large primary. What doesn't fit is ~60k writes/sec once receipts are counted, and 40 TB on one box: restores measured in hours, vacuum that falls behind, and retention fighting live sends. Logical shards start on a few physical primaries, each still with a synchronous standby, and move as they grow. The shard number is embedded in `conversation_id`, so every request routes without a lookup, and lifecycle events keyed by `study_id` land in order on the shard that owns the study.
4. **The send transaction still touches one shard.** Everything the gate reads (`state`, `writable_until`, blocks) and everything a send writes (message, outbox, receipts) is keyed by the conversation, so it's co-located. No distributed transaction, no saga: the gate is still a column read inside one `BEGIN … COMMIT`. This is what *"shardable by `study_id`, but not sharded on day one"* was buying. Message IDs stay per-shard sequences, because ordering only matters within a conversation.
5. **Conversation lists need an inbox index.** Keying by study scatters one person's conversations across shards, so *my conversations* would fan out to all 64. An inbox index sharded by `user_id` is built from the event stream and lags by about a second, which a list can tolerate. Erasure uses the same index to find every shard holding a user's messages.
6. **Outbox polling → CDC into Kafka.** Three consumers now need every send (notifier, inbox index, moderation), and polling 64 outbox tables once per consumer doesn't scale. Logical decoding streams each shard's outbox into Kafka, keyed by `conversation_id` to keep per-conversation order. Events carry IDs, not bodies, so Kafka never becomes another copy to erase. The doorbell still fires straight after commit: routing it through CDC would add a second of latency and no durability, since clients resync from Postgres anyway.
7. **Moderation becomes a pipeline.** Reports grow with users and reviewers don't autoscale, which is why moderation breaks before any database does. Classifiers score messages from the stream, severity triage orders the reviewer queues, and confident hits in severe categories freeze the conversation right away, pending a human.
8. **Retention shreds keys instead of rewriting rows.** ~200M bodies expire every day, and nulling them row by row is a second write workload as large as the average send rate. Instead, each conversation side's messages are encrypted with their own data key, held in a small key store outside the shards. Retention and erasure delete the key, which makes those bodies unreadable everywhere at once, backups and replicas included. Space comes back later: copy the few rows under `legal_hold` forward, then detach whole monthly partitions. The cost is a key fetch on sends and history reads, cached briefly in the service.
9. **Audit gets its own store.** With conversations spread across shards, the audit log can't share their transaction. Staff reads commit the audit row to a dedicated append-only store first, then read the shard. It still fails closed; the ordering is now the guarantee rather than a shared database.

**What stays the same**

The hard parts don't grow with traffic, so they don't change. The gate is still a column read inside the send transaction, every researcher-facing payload still passes through the alias serializer, staff reads are still ticket-scoped and audited before any data returns, and emails still carry a link and no body. Attachments keep the presigned, quarantined flow; only the scan workers autoscale. And it's still one UK region, spread across availability zones, because residency outranks latency for this company.

In an interview, tie every new box to the row in the table that forces it. At today's numbers none of them clears the bar, which is exactly why today's design doesn't have them.

<!-- /tabs -->

---
