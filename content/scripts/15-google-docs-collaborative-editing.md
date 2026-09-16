# Google Docs — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design Google Docs — the collaborative editing part.

@you
Let me agree what "collaborative" has to feel like, because that's where all the difficulty is.

1. Several people typing in the same document at the same moment — in the same paragraph, even?
2. My own typing never waits on the network, I assume?
3. Do I see collaborators' cursors and selections live?
4. Version history and restore?
5. Offline editing that reconciles later?
6. How big — how long can a document be, and how many simultaneous editors?

@interviewer
Yes to all of it. Documents up to around 100k characters, and about 50 people editing at once.

@you
Then here's what I'm building, and what I'm not.

**Functional:** multiple users editing the same document concurrently; every user's own edits apply **instantly**; everyone converges to the same document; live cursors and selections; full revision history and restore; offline editing that reconciles on reconnect.

**Non-functional:** **local edit latency of 0ms** — optimistic application. Remote edits visible in **under ~200ms**. **Convergence guaranteed, and never silent data loss.** Documents up to ~100k characters with ~50 simultaneous editors.

**Out of scope, deliberately:** rich media embedding, comment threads — a separate, simpler subsystem I can come back to — and the permissions model.

@interviewer
What's the hard part, in your view?

@you
Two people edit the same sentence at the same moment, with no coordination. Both must end up with an **identical** document, and **neither edit may be silently lost** — while neither of them sees their typing lag. Let me size it, and then I'll explain why the obvious conflict strategy fails.

@note · Playbook 10.1, phase 1
"0ms local latency" and "never silent data loss" are in tension, and naming both as hard requirements is what makes OT or CRDTs necessary. Stating the hard part when asked, in one sentence, shows you've recognized the prompt's cluster.

## Estimate · 3 min · Not a throughput problem

@you
- **Documents:** ~1B.
- **Concurrent edit sessions:** ~1M.
- **Op rate:** ~5 ops/sec per active editor while typing, so **a few million ops/sec** across the fleet at peak.
- **But each document is independent** — no op ever touches two documents. So this shards perfectly by `doc_id`.
- **Op size:** ~100 bytes. A long-lived document's op log can reach **millions of entries**, which makes **snapshots mandatory** — we can't replay a million ops to open a file.

The conclusion: **this isn't a throughput problem.** Each document is a small, independent, low-traffic workload — 50 editors at 5 ops a second is 250 ops a second for the busiest document. It's a **correctness-under-concurrency** problem, and the architecture follows from that: **one authoritative sequencer per document**, and a convergence algorithm.

@interviewer
So scaling to 1M concurrent documents is easy?

@you
Close to trivial. Shard session servers by `doc_id` and add servers. The fleet just needs enough capacity to own many small documents. All of the interesting work is inside one document.

@note · Playbook 10.1, phase 2
Dividing the fleet number back down to "250 ops a second for the busiest document" is the move that reframes the problem. The estimate's job here is to prove scale isn't the issue, so the remaining time goes to convergence.

## API and data model · 5 min · Every op carries the version it was based on

@you
A WebSocket for editing, REST for everything else:

- `WS /v1/docs/{id}/connect`.
  - Client sends `{type: "op", doc_id, base_version, op, client_id, seq}`.
  - Server sends `op` with the assigned `version` and `origin_client`; `ack` with `client_seq` and `version`; and `presence` with a cursor and selection.
- `GET /v1/docs/{id}` → latest snapshot plus its version.
- `GET /v1/docs/{id}/history?from=` → op history.
- `POST /v1/docs/{id}/restore {version}`.

The field that matters is **`base_version`**: every op says which version of the document the client was looking at when it made the edit. That's what lets the server know whether it's concurrent with something else.

@you · at the whiteboard
Four pieces of state:

| Table | Key | The point |
|---|---|---|
| `documents` | PK `doc_id` | `current_version`, `latest_snapshot_ref` |
| `operations` | PK `doc_id`, SK `version` | `insert \| delete`, position, content, `author_id`, `client_seq` — **append-only, server-assigned monotonic version** |
| `snapshots` | PK `doc_id`, SK `version` | content blob in object storage, every N ops |
| `presence` | Redis, `doc_id → {user_id: cursor, selection}` | **ephemeral, TTL** |

The document is a **fold over its ops**. Loading is `snapshot + ops since the snapshot`. And version history falls out for free, because the log is never mutated.

@interviewer
Why not just store the latest document text and overwrite it on save?

@you
Because two users saving concurrently would be last-write-wins, and **last-write-wins is catastrophically wrong here.** If two people type into the same paragraph and we resolve by timestamp, one person's sentence silently vanishes while they're looking at it. In a document editor that isn't an edge case, it's the normal flow. Both edits must survive and both users must see the same result — which rules out every simple conflict strategy, and it's the reason OT and CRDTs exist.

@note · Playbook 10.1, phase 3
The data model is where "why not last-write-wins?" naturally arrives, and saying *why* it fails — someone's sentence vanishes while they watch — is most of the answer to this prompt. `base_version` on every op is the field the whole algorithm depends on.

## High-level design · 10 min · Apply locally, sequence centrally, transform the rest

@you · drawing
Let me trace a keystroke from Client A.

1. A types. The client **applies the op locally, immediately** — 0ms — and puts it in a **pending buffer** with its `base_version`.
2. The op goes over the WebSocket to a **WS gateway**, which routes by `doc_id` to the **document session server** that owns this document.
3. The **sequencer** there assigns the next monotonic version.
4. If the op's `base_version` is behind, the server **transforms** it against every op applied since.
5. It's **persisted** to the append-only operations log.
6. The server **broadcasts** the transformed op to the other clients and **acks** A, which drops it from its pending buffer.
7. Client B receives it, **transforms it against B's own pending buffer**, and applies it.

Beside that: a **snapshot job** every N ops writes the folded document to object storage, and **presence** goes through Redis with a TTL, never through the op log.

@interviewer
Why apply locally before the server confirms?

@you
Because if a keystroke waits for a round trip, typing feels broken at even 50ms of latency. **Optimistic local application is non-negotiable** — everything else in the design exists to make that optimism safe. The pending buffer is how the client remembers which of its edits the server hasn't placed in the total order yet.

@interviewer
Why one session server per document?

@you
It's the **single point that assigns the total order.** Route every connection for a document to one owner by consistent hashing on `doc_id`, with leader election so exactly one node owns it at a time. Concurrency is then defined relative to one authoritative sequence. Without it, two servers could sequence conflicting ops independently, and we'd need a much harder distributed agreement protocol.

@interviewer
And when that owner dies?

@you
A new owner is elected and **rebuilds state from the persisted log** — latest snapshot plus subsequent ops. Clients reconnect and resend their unacked ops with their base versions, and the new owner transforms and applies them. The cost is a brief pause for one document, and **no data loss**, because the log is durable. Sharding by document means the blast radius is one document, not the platform.

@interviewer
Presence — does that go through the same pipeline?

@you
Deliberately not. Cursor positions change many times a second and are worthless a second later. They live in **Redis with a TTL**, broadcast at a throttled rate — a few times a second, not per keystroke — and they're **never persisted and never ordered**. Treating presence with the rigour of document ops would multiply the load for zero benefit.

@note · Playbook 10.1, phase 4
Tracing both sides — the server transforming, *and* the receiving client transforming against its own buffer — shows you understand OT is symmetric. Calling presence "deliberately lossy" is allocating engineering effort by value, which interviewers notice.

## Deep dive · 15 min · Operational transformation, CRDTs, and the edges

@you
The hard part is convergence. I can go deep on **operational transformation** — how the transform works and why it's hard to get right — or compare it with **CRDTs** and when I'd pick each. I'd do OT first, then the comparison. Work for you?

@interviewer
Go.

@you
A concrete case. The document is at **v5**. A and B both see v5.

- A inserts a character at **position 3**. It arrives first and becomes **v6**.
- B inserts at **position 7**, also based on v5. It arrives second.

If the server applies B's op as-is, it lands one character early — A's insert shifted everything after position 3 right by one. So the server **transforms** B's op against A's: A inserted *before* 7, so shift B to **8**, and apply it as **v7**. Without this, the documents **diverge forever**.

The rules generalize: an insert before your position shifts you right; a delete before your position shifts you left. And the client does the mirror image — when A's v6 arrives at B, B transforms it against its own pending insert.

@interviewer
Two users delete the same character at the same time.

@you
The second delete, transformed against the first, becomes a **no-op**. Both replicas converge, and nobody sees a double delete or an error.

@interviewer
Is OT straightforward to implement?

@you
No, and I'd rather volunteer that. OT is **notoriously hard to get right.** The transformation functions must satisfy convergence properties — TP1 and TP2 — that are easy to break in subtle ways, and the number of cases grows with the operation set. Plain-text insert and delete is manageable. **Rich text** — bold, lists, tables as attributed ranges — enlarges the transformation matrix substantially. Google Wave's OT implementation was famously difficult.

@interviewer
So how would you know it's correct?

@you
**Property-based testing.** Generate random concurrent operation sequences, apply them in every possible order across simulated clients, and assert every replica ends identical. That's how these systems are actually validated, because reasoning about the transform matrix by hand doesn't scale past a handful of op types.

@interviewer
Why not CRDTs?

@you
They're the serious alternative. A CRDT gives each character a **unique, densely ordered identifier** — a fractional index or a path in a tree — so operations **commute by construction**. Apply them in any order and every replica converges, with no central sequencer and no transformation.

| | OT | CRDT |
|---|---|---|
| Central server | required, as the sequencer | not required — works peer-to-peer |
| Metadata | low, ops are small | high — per-character IDs, and tombstones for deletes never fully go away |
| Difficulty | the transform matrix | the data structure, but it composes |
| Used by | Google Docs, Etherpad | Figma, Automerge, Yjs, most newer tools |

My recommendation: **OT when a central server already exists and document size and memory matter; CRDT when you want offline-first, peer-to-peer, or simply to avoid the transformation minefield.** For a Docs clone with a server in the loop, either is defensible. Newer systems trend toward CRDTs because the tooling has matured.

@interviewer
Offline editing — does your OT design handle it?

@you
For short absences, well. The client queues ops locally with their base version, and on reconnect the server transforms each against everything that happened meanwhile. For **long** absences the transformation chain gets expensive, and the result can be **semantically surprising even though it's technically convergent** — two people rewrote the same section in different directions for a week. At that point, a "review changes" step is more honest than a silent auto-merge. CRDTs handle this case more gracefully, which is a fair reason to prefer them if offline-first is core.

@interviewer
Undo?

@you
Harder than it looks. Undo must be **local** — undoing *my* last edit, not whoever edited most recently. So each user has an undo stack whose entries are **themselves transformed** as other people's ops arrive, because the text I want to undo may have moved. It's a known complexity, not a free feature.

@interviewer
Restoring an old version?

@you
It's **not a rewind.** Restoring v120 appends new ops that transform the current state back into v120's content, so the history — including everything after v120 — stays intact. The log is never mutated or truncated.

@interviewer
A client sends an op based on a version you've garbage-collected.

@you
Then don't garbage-collect the op log. **Keep it.** Snapshots are an optimization on top of the log, not a replacement for it — the log is what makes history, restore and late reconnects work.

@note · Playbook 10.1, phase 5
A worked transform with real positions is worth more than any definition of OT. Volunteering that OT is hard to implement, and naming property-based testing as the answer, is the credibility signal on this prompt — presenting OT as easy is the specific mistake.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
Session count isn't what breaks — documents are independent. What 10x really brings is **big audiences** and **users in every region**.

1. **Viewers stop costing the owner.** A company-wide doc with 10k people watching would make one server write every op to 10k sockets. Editors still get every op directly; viewers read from a per-document pub/sub topic, batched every ~200ms. The owner's work grows with editors, not audience.
2. **Ownership moves near the editors.** An owner on another continent delays every collaborator's edits. Run it in the region nearest most active editors, and hand off when that shifts — which is just the failover path, run on purpose.
3. **Leases instead of per-document elections**, taken on first open and dropped when idle, with a fencing epoch so a paused old owner can't write after a handoff.
4. **Group commit** — batch ops from all documents a server owns into one log write every few milliseconds, well inside the 200ms budget.
5. **Snapshot on idle** too, so the next open, maybe on another owner, is fast.
6. **Sampled presence** — ten thousand viewer cursors is noise, so show editors plus "and 9,400 others".

@interviewer
Comments and suggestions?

@you
A separate, much simpler subsystem. A comment anchors to a position range, and it only needs its anchor **transformed** when the document shifts — not full convergence. Keeping it out of the core editing path is the right scoping.

@you
What I'd monitor: **op ack latency p99**, which is what collaborators feel; **transform rate and chain length**, since long chains mean clients are far behind; divergence checks — periodically hash each client's document and compare against the server's version, because divergence is the one bug that must never be silent; ownership handoff and failover counts; snapshot age per active document; and reconnects with large unacked buffers.

@you
To close: every client applies its own edits instantly and keeps them in a pending buffer. One session server per document sequences ops into a total order and transforms stale ones, clients transform incoming ops against their own buffers, and everything lands in an append-only log with snapshots on top. Presence is lossy on purpose. Last-write-wins would lose someone's sentence while they watched, and the entire design exists so that never happens.

@note · Playbook 10.5
Monitoring for divergence with periodic hash comparison turns "convergence guaranteed" from a claim into something you'd verify in production. The close ends on the failure the design prevents, which is the requirement the interviewer will remember.
