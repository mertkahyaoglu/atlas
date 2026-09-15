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
  outOfScope: "group chat, end-to-end encryption (it would blind support and moderation, so say why it's excluded), message search, typing indicators beyond a mention, multi-region deployment, voice and video."
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

```schema
# Postgres · primary + synchronous standby
conversations || PK: conversation_id UNIQUE: (study_id, researcher_id, participant_id) || participant_alias, state (open | frozen), writable_until, study_version, retention_deadline, legal_hold || the triple is the identity; state is materialized from lifecycle events
messages || PK: (conversation_id, message_id) UNIQUE: (conversation_id, client_msg_id) || sender_role, body (nullable), attachment_id, created_at, erased_at || message_id from a sequence: one writer, no Snowflake needed
receipts || PK: (conversation_id, role) || last_delivered_msg_id, last_read_msg_id || two rows per conversation; pointers only move forward
blocks || PK: (conversation_id, blocker_role) || created_at || checked inside the send transaction
attachments || PK: attachment_id || conversation_id, object_key, content_type, size, status (quarantined | clean | rejected) || bytes live in object storage; download URLs minted per request
notification_outbox || PK: outbox_id || recipient_id, conversation_id, message_id, not_before, sent_at || committed with the message; the worker debounces
# Safety and compliance
reports || PK: report_id || conversation_id, reporter_role, category, evidence_snapshot, status || opening a report sets legal_hold
audit_log || PK: audit_id || actor_id, ticket_id, conversation_id, action (view | unmask), reason, created_at || INSERT-only grant; shipped to write-once storage
```

Two columns on `conversations` carry most of the design. The `(study_id, researcher_id, participant_id)` triple is the identity, which makes creation idempotent and scopes every rule to one study. `state` plus `writable_until` is the gate every send passes through, in the same transaction as the insert.

---

## High-level architecture

```mermaid
flowchart TB
    P([Participant]) -- "WSS · send" --> GWA["WS gateway #1<br/>sender's socket"]
    GWA --> Gate

    subgraph SEND ["Chat service · one transaction"]
        direction TB
        Gate["1 · gate, else 409 / 429<br/>conversation open<br/>before writable_until<br/>not blocked · under limit"]
        Write["2 · insert message<br/>+ outbox row<br/>dedupe on client_msg_id"]
        Ack["3 · commit, then ack"]
        Gate --> Write --> Ack
    end

    Study["Study service<br/>owns study state"] -. "lifecycle events" .-> Consumer["Lifecycle consumer<br/>study_version guard"]
    Consumer --> PG
    Write --> PG[("Postgres · truth<br/>sync standby<br/>messages · outbox<br/>audit_log")]

    Ack -- "4 · publish" --> Redis{{"Redis<br/>pub/sub doorbell<br/>rate-limit buckets"}}
    Redis -- "5 · subscribed gateway" --> GWB["WS gateway #3<br/>recipient's socket"]
    GWB -- "WSS · alias only" --> R([Researcher])

    PG --> Notifier["Notifier worker<br/>skip if read · debounce"]
    Notifier --> Email["Email / push<br/>link only, no body"]

    Staff["Staff console<br/>ticket-scoped reads<br/>four-eyes unmask"] -- "audit row, then read" --> PG
    Retention["Retention + erasure<br/>honours legal_hold"] --> PG
    Retention --> Obj[("Object storage<br/>presigned PUT<br/>quarantine → scan")]

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class PG,Obj store
    class Gate,Staff hot

    click GWA href "/docs/07-apis-and-communication" "Role: holds the sender's socket and forwards frames to the chat service.<br/>Trade-off: stateful, but three nodes with a spare is the whole scaling story here."
    click Gate href "/docs/03-consistency-and-distributed-systems" "Role: checks study state, blocks and rate limits in the same transaction as the insert.<br/>Trade-off: state is materialized from events, so a study closure lands a few seconds late."
    click PG href "/docs/02-data-storage" "Role: source of truth for conversations, messages, the outbox and the audit log.<br/>Trade-off: the synchronous standby adds a little commit latency so failover never loses an acked message."
    click Redis href "/docs/05-async-messaging-and-event-driven" "Role: rings the recipient's gateway after commit and holds rate-limit buckets.<br/>Trade-off: pub/sub drops publishes nobody hears, so clients resync from Postgres on reconnect."
    click Consumer href "/docs/05-async-messaging-and-event-driven" "Role: turns study lifecycle events into conversation state.<br/>Trade-off: events repeat and reorder, so every update is guarded by study_version."
    click Notifier href "/docs/03-consistency-and-distributed-systems" "Role: drains the transactional outbox into debounced email and push.<br/>Trade-off: at-least-once, so a crash mid-send can produce a duplicate email."
    click Obj href "/docs/09-specialized-building-blocks" "Role: attachment bytes, quarantined until scanned and served through short-lived URLs.<br/>Trade-off: scanning delays an attachment's appearance by a few seconds."
    click Staff href "/docs/08-reliability-and-operations" "Role: ticket-scoped support access and audited unmasking.<br/>Trade-off: reads fail closed if the audit write fails, choosing consistency over availability."
    click Retention href "/docs/08-reliability-and-operations" "Role: enforces retention deadlines and erasure requests.<br/>Trade-off: backups can't be edited, so erasure is replayed after restores or keys are shredded."
```

<details>
<summary>Plain-text version of this diagram</summary>

```text
 [Participant]                                          [Researcher]
       │ WSS · send                                          ▲ WSS · alias only,
       ▼                                                     │ never participant_id
┌──────────────────────┐                          ┌──────────┴───────────┐
│ WS GATEWAY #1        │   3 nodes, N+1 spare     │ WS GATEWAY #3        │
│ holds sender socket  │   sockets only           │ subscribed to        │
└──────────┬───────────┘                          │ user:<researcher>    │
           │ 1. send frame                        └──────────────────────┘
           ▼                                                   ▲
┌────────────────────────────────────────────┐                 │ 5. push
│ CHAT SERVICE · one transaction per send    │                 │
│                                            │                 │
│ 2. token bucket in Redis, else 429         │                 │
│ 3. BEGIN                                   │                 │
│      state = open, now < writable_until,   │                 │
│      sender not blocked, else 409          │                 │
│      INSERT message, dedupe client_msg_id  │                 │
│      INSERT notification_outbox            │                 │
│    COMMIT, then ack "sent" to sender       │                 │
└──────────┬──────────────────────┬──────────┘                 │
           │ durable              │ 4. publish                 │
           ▼                      ▼                            │
┌─────────────────────────┐  ┌──────────────────────────────┐  │
│ POSTGRES · truth        │  │ REDIS pub/sub                │  │
│ primary + sync standby  │  │ doorbell only: a missed      ├──┘
└─────────────────────────┘  │ publish is repaired by       │
                             │ cursor resync on reconnect   │
                             └──────────────────────────────┘

 STUDY SERVICE ──lifecycle events──► LIFECYCLE CONSUMER
                 late, repeated or   UPDATE conversations SET state = …
                 out of order        WHERE study_version < event_version

 notification_outbox ──► NOTIFIER WORKER ──────────────► email / push
                         SKIP LOCKED · skip if read      link only,
                         debounce per conversation       no message body

 client ──presigned PUT──► OBJECT STORAGE · UK region
                           quarantine → AV scan, sniff type, strip EXIF
                           → clean → short-lived GET URL per request

 STAFF CONSOLE ──► 1. INSERT audit_log (if this fails, the read fails)
                   2. read a conversation linked to the ticket
                   3. unmask only with a reason + a second approver

 RETENTION + ERASURE ──► past retention_deadline, no legal_hold
                         → NULL bodies, delete objects, keep tombstones
```

</details>

---
