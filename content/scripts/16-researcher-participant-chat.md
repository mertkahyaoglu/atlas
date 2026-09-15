# Researcher–Participant Chat — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design the chat that lets a researcher running a study talk to the participants taking part in it — Prolific, Respondent, that kind of platform.

@you
Let me play that back and then agree the shape with you. Two roles: researchers, who are verified companies paying for studies, and participants, who take part in them. A conversation is about a specific study, not an open-ended thread between two people.

Four things I want to pin down before I design anything:

1. Is the participant anonymous to the researcher, or do they see each other's real identities?
2. Can participants message each other, or is it only researcher ↔ participant?
3. How long does the ability to chat last — forever, or only while the study is live?
4. Where is the company, and is the content regulated? Chat about a study is health data more often than anyone expects.

@interviewer
Participants are anonymous to researchers — that's a platform promise, and researchers must never learn who they are. Researchers are verified, and participants see the company name. No participant-to-participant chat. Support has to be able to resolve disputes about payments. We're a UK company.

@you
Then here's what I'm building, and what I'm not.

**Functional:** 1:1 messaging scoped to a study; persistent history with pagination; real-time delivery when both are online and an email or push when they're not; delivery and read receipts; attachments; report and block; and a support view for disputes.

**Non-functional:** never lose a message — durable before we ack. Presence and typing indicators can be lossy. UK GDPR, so retention limits and the right to erasure are enforced by the system rather than promised in a policy. The participant's identity is masked from the researcher unless it's revealed through an audited path. And access is gated by the study's lifecycle state, not just by whether these two people are allowed to talk.

**Out of scope, deliberately:** group chat, message search, voice and video, multi-region. And end-to-end encryption — I want to say why, because it's the interesting cut. E2EE would blind support and moderation, and this platform's promise is that a participant who is harassed or shorted on payment has someone to appeal to. So it's excluded by the product, not by the difficulty.

@interviewer
Fine. Scale?

@you
Let's put numbers on it before I commit to anything.

@note · Playbook 10.4
The most common way to lose this round is to skip this phase. Notice that the three hardest requirements — lifecycle gating, masking, retention — all came out of clarification, not out of the diagram. Cutting E2EE *with a reason* is worth more than listing it as out of scope.

## Estimate · 3 min · Numbers, each one with a conclusion

@you
Assumptions, tell me if any of these are wrong: about 200k monthly active participants, 10k researchers.

- **Connections:** participants mid-study plus researchers with a dashboard open — roughly 30k concurrent at peak.
- **Messages:** ~2M a day. That's ~25/sec average, and if I take an 8x peaking factor, ~200/sec.
- **Storage:** a message row is about 0.5 KB, so ~1 GB/day. Under a 12-month retention cap that's ~400 GB of message rows.
- **Attachments:** about 1% of messages, ~1 MB each, so ~20 GB/day. That's object storage, not the database.
- **Gateways:** 30k sockets at ~10k per node — well under the ~50k ceiling — is 3 nodes with one to spare.

The conclusion, and it's the most important sentence I'll say today: **every one of those numbers fits one Postgres primary, one Redis and three gateway nodes.** This is roughly twenty thousand times less write load than a Slack-scale design. So I'm not going to spend this interview on sharding. I'm going to spend it on who may talk when, who may see whom, and how long anything is kept.

@interviewer
You're confident one Postgres handles it?

@you
At 200 sends/sec, yes, and it's really ~600 writes/sec once receipts are counted. A relational store also fits the access pattern: every send is an authorization check across conversation state and blocks, then an insert, and I want those in one transaction.

Two choices here are about correctness rather than capacity. I'd run a **synchronous standby**, because failing over to an async replica can drop a message that was already acked, and that's the one loss the requirements forbid. And I'd design the schema to be shardable by `study_id` — but I wouldn't shard on day one.

@note · Playbook 10.3
"I'd keep it shardable but I wouldn't shard on day one" is the sentence that separates judgment from pattern-matching. Naming a technology you *aren't* using — no Cassandra, no Kafka, no Snowflake service — earns the same credit as naming one you are, as long as you say what traffic would change your mind.

## API and data model · 5 min · The contract, and the two columns that carry the design

@you
A WebSocket for the live path, REST for everything else. Six endpoints that matter:

- `POST /v1/conversations {study_id, submission_id}` — opens or returns the conversation. Note what's missing: nobody ever sends a `participant_id`. The researcher opens a chat from a submission and the server resolves who that is.
- `GET /v1/conversations/{id}/messages?before=&limit=50` — history, and `?after={message_id}` for resync after a reconnect.
- `POST /v1/conversations/{id}/messages {client_msg_id, body}` — the HTTP fallback for sending; 409 when the conversation isn't writable, 429 when rate limited.
- `POST /v1/conversations/{id}/attachments` — returns a presigned upload URL.
- `POST /v1/conversations/{id}/report` and `/block`.
- And separately, `GET /staff/v1/tickets/{ticket_id}/conversations/{id}`, plus `POST /staff/v1/conversations/{id}/unmask`. Staff endpoints live behind their own prefix and role because they follow different rules.

@you · at the whiteboard
The schema is seven tables, and two columns carry most of the design:

| Table | Key | The point |
|---|---|---|
| `conversations` | PK `conversation_id`, **UNIQUE `(study_id, researcher_id, participant_id)`** | `participant_alias`, `state`, `writable_until`, `study_version`, `retention_deadline`, `legal_hold` |
| `messages` | PK `(conversation_id, message_id)`, UNIQUE `(conversation_id, client_msg_id)` | body is nullable, because retention nulls it and keeps the row |
| `receipts` | PK `(conversation_id, role)` | `last_delivered_msg_id`, `last_read_msg_id` — pointers, not per-message rows |
| `blocks` | PK `(conversation_id, blocker_role)` | read inside the send transaction |
| `attachments` | PK `attachment_id` | `status: quarantined \| clean \| rejected` |
| `notification_outbox` | PK `outbox_id` | committed with the message |
| `reports`, `audit_log` | | `audit_log` has an INSERT-only grant |

`state` plus `writable_until` on the conversation row is the gate every send passes through, in the same transaction as the insert. I'll come back to that in the deep dive.

@interviewer
Why the natural key on conversations rather than just an id?

@you
Because it makes opening a conversation idempotent. `INSERT … ON CONFLICT DO NOTHING`, then read the row: two browser tabs both clicking *Message participant* converge on one conversation instead of racing to create two threads someone later has to merge.

It also settles scoping for free. A researcher who works with the same participant in two studies gets two conversations, two aliases, and two independent sets of access rules — which is exactly the anonymity property we promised, enforced by a unique constraint rather than by application code remembering to do it.

@note · Playbook 10.1, phase 3
For every table, say the key and why. Here the key *is* an argument: it buys idempotent creation, per-study scoping and unlinkable aliases in one line of DDL.

## High-level design · 10 min · One send, end to end

@you · drawing
Seven boxes. Let me trace a send from a participant to a researcher who's online.

1. The participant's client holds a WSS connection to **WS gateway #1**. It sends a frame with a `client_msg_id`.
2. The gateway forwards it to the **chat service**, which checks the sender's **token bucket in Redis** — if it's empty, 429, before any database work.
3. `BEGIN`. The **gate**: is the conversation open, are we still before `writable_until`, is there no block? If not, 409 with a reason. Otherwise insert the message and a `notification_outbox` row, deduping on `client_msg_id`. `COMMIT`.
4. **Only now** ack `sent` to the participant, with the server-assigned `message_id`.
5. Publish to the recipient's Redis channel, `user:<id>`. Redis delivers it to whichever gateway holds that socket — #3 — which pushes it to the researcher with **the alias only**.

Order matters in step 4: if I acked at the gateway and the gateway died, the message would vanish with a checkmark showing next to it. Durable, then ack.

@you
The second flow is the offline one, because half the time the researcher isn't looking. The outbox row committed in the same transaction as the message, so there's no dual write to lose. A worker claims due rows with `FOR UPDATE SKIP LOCKED` after a short delay, then checks: has the recipient already read it, or are they connected right now? Drop it. Are there more messages in the same conversation in the window? Collapse them into one notification — *3 new messages about 'Sleep study'*.

And the email contains **no message content**, only a link. Once text lands in someone's inbox it's outside retention and erasure control, and the email provider becomes a processor of research data.

@interviewer
You mentioned Slack earlier. Slack-style designs have a connection registry — user to gateway. Where's yours?

@you
Deliberately absent. With three gateways, each gateway subscribes to `user:<id>` for every socket it holds, so **the subscriptions are the routing table**. Redis delivers only to the node that has the socket; there's no broadcast to all nodes and no extra Redis lookup on the send path.

The registry earns its keep at a thousand gateways, where per-user subscriptions no longer fit on one Redis and Redis Cluster's pub/sub fans out to every node. That's the point where I'd add it — and at that point it also starts answering questions I get for free today, like which of a user's devices are online.

@interviewer
And if Redis drops a publish? Or a gateway dies mid-conversation?

@you
Nothing is lost, because the message was committed before anyone was told about it. Pub/sub here is a doorbell, not a delivery guarantee. The client reconnects with jittered backoff, sends the highest `message_id` it holds per open conversation, and pages the gap from Postgres. At-least-once delivery, dedupe on `message_id` at the client.

I'll add that WebSockets aren't even mandatory at this scale — Server-Sent Events for incoming messages plus ordinary POSTs for sends would work, and would reuse normal HTTP auth, rate limiting and proxies. Either is defensible; I'd pick WSS because we already need a bidirectional channel for typing and receipts.

@note · Playbook 10.1, phase 4
Two flows, not one: the online path and the offline path. And when you consciously *omit* a component the interviewer expects, name the number that would bring it back. That converts "you forgot the registry" into "you've thought about the registry."

## Deep dive · 15 min · The gate, the alias, and audited staff access

@you
I think the two genuinely hard parts here are the authorization gate — which depends on state this service doesn't own — and the anonymity boundary, including how support breaks it. Want me to start with gating, or would you rather go straight to the anonymity and staff-access side?

@interviewer
Start with gating.

@you
The Study service owns the lifecycle: invited, active, submission approved, study completed. The naive design calls it on every send. I don't want that, because then chat is down whenever the Study service is down, and it puts a network call inside my send transaction.

Instead, chat **consumes lifecycle events** and materializes the result onto the conversation row, so the gate is a column read:

| Lifecycle event | Conversation change | Who can send |
|---|---|---|
| Participant invited / submission started | `state = open` | both |
| Study completed | `writable_until = now + 30 days` | both, until the dispute window ends |
| Report under review | `state = frozen` | support only |
| Retention deadline passes | bodies purged, row kept as a tombstone | nobody |

Three details make this correct. Events arrive late, twice and out of order, so every update is guarded with `WHERE study_version < $event_version` — a replayed old event can never reopen a closed conversation. The gate is on the *pair*, not the study, because a study can still be active while this particular participant's submission is already approved. And the dispute window is a timestamp checked at send time, so no cron job has to flip anything.

The cost is a few seconds of staleness after a study closes. That's harmless. Chat failing whenever the Study service fails is not.

@interviewer
A participant hits send at the exact moment the dispute window closes. What happens?

@you
The gate and the insert are the same transaction, so there's no window to be in. Either the row is inserted while `writable_until` was still in the future, or the transaction rejects with a 409 carrying a reason the client can render — "chat for this study has closed". The draft stays in the composer rather than disappearing, and support can reopen the conversation if there's a genuine dispute. That's why the gate is a column on the row I'm about to write to, not a service call: it makes the check and the write atomic.

@you
Now anonymity. The researcher sees `Participant 7Q3K`, an alias generated when the conversation is created and stored on its row. Per conversation, not per participant — so a researcher running three studies can't correlate the same person across them. The participant sees the researcher's verified workspace name, because researchers are the accountable, paying side. The asymmetry is deliberate.

The enforcement matters more than the scheme: **one choke point**. A role-aware serializer that every researcher-facing payload passes through — REST responses, WebSocket frames, notification emails — with a test that fails the build if `participant_id` ever appears in a researcher payload. Masking sprinkled across handlers leaks the first time someone adds an endpoint in a hurry.

@interviewer
A participant types their email address into the chat. Is your anonymity broken?

@you
Yes, and no system can prevent voluntary disclosure. What the system can do is make it deliberate rather than accidental: detect emails, phone numbers and social handles before the message sends and ask for confirmation; strip EXIF on image upload, because a photo of a consent form carries GPS coordinates; and flag researchers who repeatedly ask for contact details, since that breaks platform policy and moderation should see the pattern.

The guarantee I'd actually write down is that the *platform* never reveals identity — not that two humans can't defeat it.

@interviewer
Someone on the support team wants to browse one participant's chats. What stops them?

@you
No endpoint allows it. Staff access is break-glass, not a query:

- **Ticket-scoped reads.** Staff open conversations that are linked to a dispute or a report. There is no search box over all chats.
- **Audit first, then read.** The audit row is written *before* any data is returned, and if that write fails, the read fails. This is the one place in the design where I pick consistency over availability, and I want to say that out loud.
- **Four-eyes unmasking.** Revealing who is behind an alias needs a reason and a second approver. Revealing it *to the researcher* also notifies the participant.
- **Tamper-resistant log.** The service's database role can only `INSERT` into `audit_log`, and rows ship to write-once storage, so an insider can't erase their own trail. Access volume per staff member is alerted on and reviewed by someone outside support.

I can't stop an authorized reader from taking notes on what they see. I can make every read attributable, rare, and reviewed by someone who doesn't report to the same manager.

@you
Two more parts of the send path, quickly, because they're requirements rather than optimizations.

**Abuse.** These are strangers, and money is involved. Redis token buckets per sender per conversation, per sender overall, and a daily cap on *new* conversations per researcher, because mass cold outreach is the spam pattern here. New accounts get tighter buckets. Blocks are rows checked inside the send transaction — a client-side hide is not a block — and the blocked side sees a neutral "conversation closed" rather than something that invites retaliation. Reports snapshot the reported messages into the moderation case and set `legal_hold`, so the reported party can't delete the evidence and the retention job can't purge it mid-investigation.

**Attachments.** The client asks for an upload URL; the server applies the same gate as a send, plus a type allowlist and a size cap, and returns a presigned `PUT` into a quarantine prefix. The bytes never touch the app servers. An object-created event triggers antivirus, content-type sniffing from magic bytes rather than the file extension, and EXIF stripping. Only a clean object gets attached to a message. Downloads are short-lived presigned `GET`s minted per request after authorization, so a block, a freeze or a purge takes effect immediately with no permanent URLs to revoke.

@you
And retention, which is a real subsystem here rather than a footnote. When the dispute window ends, set `retention_deadline` — say twelve months out. A nightly batched, rate-limited job nulls message bodies and deletes attachment objects past the deadline unless `legal_hold` is set, leaving the rows as tombstones so receipts and audit references stay valid.

An erasure request removes the requester's bodies and attachments and leaves "message deleted" markers, so the other side's history still reads coherently. It isn't absolute — an open safeguarding report justifies keeping evidence under the legal-claims exemption, which is exactly what `legal_hold` records.

The part people forget: every copy is one more thing to erase. So no message bodies to analytics, no search index, short backup retention with an erasure ledger replayed after a restore. And one UK region for the database, Redis and the bucket — for this company, single-region is a compliance feature, not a limitation.

@note · Playbook 10.1, phase 5
Offering the interviewer a choice of deep dive is confident and lets them steer to what they're assessing. Notice that every answer in this phase lands back on one of two mechanisms — the gate inside the transaction, and the single serializer boundary. Depth means going two or three levels into the same mechanism, not touring more components.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
Let me name what breaks first, because it isn't the database.

At 10x — 2,000 messages/sec — Postgres is still comfortable and gateways scale out. **The first thing to break is human moderation.** Reports grow with users and reviewers don't autoscale, so severity triage and classifier-assisted queues come before any database work. Second is the retention and erasure jobs starting to compete with live traffic, which is when partitioning messages by month, so old data can be dropped in bulk instead of rewritten row by row, starts paying for itself.

At 100x I'd shard by `study_id` — the shard key I chose on day one — move the doorbell to a connection registry, and switch retention from nulling rows to shredding per-conversation encryption keys.

@you
What I'd monitor: outbox lag, because it rises before anyone notices a missing email; the 429 rate per researcher, because a spike is either an integration bug or an outreach spammer; **failed audit writes**, since those fail closed and make support blind; unmask counts per staff member per week, as a safeguarding signal rather than an ops one; and reconnect storms after a deploy, which size the gateway tier more than steady traffic does.

@interviewer
Last question. Why build this at all — why not buy Sendbird or Stream?

@you
That's a legitimate answer at this scale and I'd want it on the table. But look at what buying removes. It removes sockets, history storage and fan-out — the parts that took me five minutes today. It doesn't remove study-state gating, alias masking, audited staff access, retention or erasure, because those are our policy and they live in our code either way.

And it adds something: every message now flows through a third-party processor, which needs a data processing agreement, UK hosting, and deletion guarantees we can evidence to a regulator. So buying takes away the easy part and adds compliance surface to the hard part. I'd build.

@interviewer
Could you have dropped Redis entirely and used Postgres `LISTEN/NOTIFY`?

@you
At three gateways, plausibly — and `NOTIFY` only fires on commit, which is a genuinely nice property for a doorbell. The costs: payloads cap at 8 KB, listeners need dedicated connections that don't survive transaction-pooling PgBouncer, and notifications sent while a listener is disconnected are simply gone. That last one the cursor resync already repairs. Redis stays mostly because the rate-limit buckets need it anyway, so it isn't an extra dependency.

@you
To close: the design is small on purpose. One Postgres, one Redis, three gateways, an outbox and an object store. What makes it a real system is the gate inside the send transaction, one serializer that owns masking, and an audit log that's written before support sees anything. If I had another week, I'd spend it on moderation tooling rather than on throughput.

@note · Playbook 10.5
Volunteering the limits — moderation before database, retention jobs second — reads as senior. Claiming a design has no bottlenecks is a specific credibility hit. Finishing with what you'd do *next* leaves the interviewer with a shape they can imagine planning work against, which is the question they're really answering about you.
