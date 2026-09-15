---
group: "design"
order: 15
title: "Google Docs"
summary: "Many people typing into one document at once, with no perceptible lag and no lost edits."
hardPart: "Convergence. Two users edit the same sentence with no coordination. Both must end up with an identical document and neither edit may be silently lost — so last-write-wins is catastrophically wrong."
tags: ["crdt", "consistency", "websockets", "realtime"]
hardPartDetail: "Convergence. Two users edit the same sentence simultaneously with no coordination. Both must end up with an identical document, neither edit may be silently lost, and neither user may see their own typing lag. Last-write-wins is catastrophically wrong here, and saying why is most of the answer."
concepts:
  - "Operational Transformation (OT)"
  - "CRDTs"
  - "causal consistency"
  - "WebSockets"
  - "event sourcing"
  - "optimistic local application"
  - "presence"
  - "snapshotting"
requirements:
  functional:
    - "Multiple users edit the same document concurrently"
    - "Every user's local edits apply instantly (no round-trip lag while typing)"
    - "All users converge to the same final document"
    - "Live cursors and selections of collaborators"
    - "Full revision history and restore"
    - "Offline editing that reconciles on reconnect"
  nonFunctional:
    - "Local edit latency: 0ms (optimistic application)"
    - "Remote edit visibility: under ~200ms"
    - "Convergence guaranteed, never silent data loss"
    - "Documents up to ~100k characters with ~50 simultaneous editors"
  outOfScope: "rich media embedding, comment threads (a separate, simpler subsystem), permissions model details."
scale:
  numbers: |-
    Docs:            1B
    Concurrent edit sessions: 1M
    Ops per active editor:    ~5/sec while typing
    Peak op rate:             a few M/sec across the fleet, but each doc
                              is independent → shard by doc_id
    Op size:                  ~100B; a doc's op log can reach millions of entries
                              → SNAPSHOTS are mandatory
  conclusion: "This is not a throughput problem — each document is an independent, small, low-traffic workload. It's a *correctness under concurrency* problem, and the architecture follows from that: one authoritative sequencer per document, and a convergence algorithm."
tradeoffs:
  - title: "Why last-write-wins is wrong here"
    body: |-
      If two users type into the same paragraph and you resolve by timestamp, one person's sentence silently vanishes while they're looking at it. In a document editor that's not an edge case, it's the normal flow. The requirement is that *both* edits survive and both users see the same result. That rules out every simple conflict-resolution strategy and is why OT and CRDTs exist.
  - title: "Optimistic local application is non-negotiable"
    body: |-
      If a keystroke waits for a server round trip, typing feels broken at even 50ms of latency. So the client applies immediately, buffers the op as unacknowledged, and reconciles when the server responds. Everything else in the design exists to make that optimism safe.
  - title: "Operational Transformation, in plain terms"
    body: |-
      Each operation carries the document version it was based on. When an op arrives based on a stale version, the server transforms it against every op that has been applied since, adjusting positions so the *intent* is preserved. An insert before your position shifts you right; a delete before your position shifts you left. The client performs the mirror-image transformation on incoming ops against its own pending buffer.

      The honest caveat, worth volunteering: OT is notoriously difficult to implement correctly. The transformation functions must satisfy convergence properties (TP1/TP2) that are easy to get subtly wrong, and the number of cases grows with the richness of the operation set. Google Wave's OT implementation was famously hard. Acknowledging this is more credible than presenting OT as straightforward.
  - title: "CRDTs, the alternative"
    body: |-
      Conflict-free Replicated Data Types assign each character a unique, densely-ordered identifier (a fractional index or a path in a tree), so operations are commutative by construction. Apply them in any order and you converge — no central sequencer, no transformation.

      | | OT | CRDT |
      |---|---|---|
      | Needs central server | yes (sequencer) | no — works peer-to-peer |
      | Metadata overhead | low (ops are small) | high (per-character IDs; tombstones for deletes never fully go away) |
      | Implementation | complex transform matrix | complex data structure, but composable |
      | Used by | Google Docs, Etherpad | Figma, Automerge, Yjs, most newer tools |

      **The recommendation to state:** OT when a central server already exists and document size/memory matters; CRDT when you want offline-first, peer-to-peer, or simply want to avoid the transformation minefield. For a Google Docs clone with a server in the loop, either is defensible — what matters is that you can articulate the trade rather than declaring one universally better. Newer systems trend toward CRDTs because the tooling has matured.
  - title: "One authoritative owner per document"
    body: |-
      Route all connections for a document to a single session server via consistent hashing on `doc_id`, with leader election so exactly one node owns it at a time. This gives a single point that assigns the total order. Without it, two servers could sequence conflicting ops independently and you'd need a much harder distributed agreement.

      The failure question follows immediately: if that node dies, a new owner is elected and rebuilds state from the persisted op log (snapshot plus subsequent ops). Clients reconnect, send their unacked ops with base versions, and the new owner transforms and applies them. Brief unavailability for one document, and no data loss because the log is durable. Sharding by document means the blast radius is one document, not the platform.
  - title: "Snapshotting is mandatory"
    body: |-
      A long-lived document accumulates millions of ops. Replaying all of them to open the file would take forever. Snapshot the materialized content every N ops (or on a timer), store it in object storage, and load as `snapshot + ops since snapshot`. This is standard event-sourcing practice, and forgetting it is a common gap.
  - title: "Presence is deliberately lossy"
    body: |-
      Cursor positions update many times per second and are worthless a second later. Keep them in Redis with a TTL, broadcast at a throttled rate (a few times per second, not per keystroke), and never persist or order them. Treating presence with the same rigor as document ops would multiply your load for zero benefit — and saying so shows you're allocating engineering effort by value.
  - title: "Offline editing"
    body: |-
      The client queues ops locally with their base version. On reconnect it sends the queue; the server transforms each against everything that happened meanwhile. This works well for short absences. For long ones the transformation chain gets expensive and the result can be semantically surprising even if technically convergent — at which point offering the user a "review changes" step is more honest than silent auto-merge. CRDTs handle this case more gracefully, which is a fair reason to prefer them if offline-first is a core requirement.
  - title: "Undo is harder than it looks"
    body: |-
      Undo must be *local* — undoing your own last edit, not whoever edited most recently. That means maintaining a per-user undo stack whose entries are themselves transformed as other people's ops arrive, since the thing you want to undo may have moved. Worth raising as a known complexity rather than assuming it's free.
  - title: "Version history"
    body: |-
      Falls out of the append-only log for free. Restoring a version is not a rewind — it's appending the ops that transform current state back to the target state, preserving history. Never mutate or truncate the log.
followUps:
  - question: "Two users delete the same character simultaneously."
    answer: "The second delete transforms into a no-op. Both converge; nobody sees a double-delete or an error."
  - question: "How do you scale to 1M concurrent documents?"
    answer: "Trivially — documents are independent. Shard session servers by `doc_id` and scale horizontally. The per-document workload is small; the fleet just needs enough capacity to own many documents."
  - question: "Rich text formatting, not just plain characters?"
    answer: "Model formatting as attributed ranges and define transformations for attribute operations. It substantially enlarges the transformation matrix, which is exactly the OT complexity problem manifesting."
  - question: "How do you prove convergence?"
    answer: "Property-based testing: generate random concurrent operation sequences, apply them in every possible order across simulated clients, and assert all replicas end identical. This is how these systems are actually validated, since reasoning about the transform matrix by hand doesn't scale."
  - question: "What if a client sends an op based on a version the server has garbage-collected?"
    answer: "Don't garbage-collect the op log — keep it. Snapshots are an optimization on top of it, not a replacement."
  - question: "Comments and suggestions?"
    answer: "A separate, much simpler subsystem — comments anchor to a position range and only need position transformation when the document shifts, not full convergence. Distinguishing them from the core editing path shows appropriate scoping."
---
# 15 — Google Docs / Collaborative Editing

## API / Model

```api
# WebSocket
WS /v1/docs/{id}/connect || || 101
+ → client sends: {type:"op", doc_id, base_version, op, client_id, seq}
+ ← server sends: {type:"op", version, op, origin_client}
+                 {type:"ack", client_seq, version}
+                 {type:"presence", user_id, cursor, selection}
# REST
GET /v1/docs/{id} || || 200 latest snapshot + version
GET /v1/docs/{id}/history?from= || || 200 op history
POST /v1/docs/{id}/restore || {version} || 200
```

```schema
documents || PK: doc_id || title, owner, current_version, latest_snapshot_ref ||
operations || PK: doc_id SK: version || op (insert|delete, position, content), author_id, client_seq, ts || append-only with a monotonic, server-assigned version; the doc is a fold over ops
snapshots || PK: doc_id SK: version || content blob (object storage), created_at || taken every N ops so loading doesn't replay millions of entries
presence || || Redis, ephemeral: doc_id → {user_id: {cursor, selection, ts}} || TTL
```

---

## High-level architecture

<!-- tab: Today · 1M sessions -->

```mermaid
flowchart TB
    subgraph CA ["Client A"]
        direction TB
        TypeA["User types"]
        LocalA["APPLY LOCALLY IMMEDIATELY · 0ms<br/>never wait for the server —<br/>typing must not feel laggy"]
        PendA[("Pending buffer<br/>unacked ops + base_version")]
        TypeA --> LocalA --> PendA
    end

    PendA -- "WebSocket" --> GWin["WS Gateway · ingress<br/>routes by doc_id"]
    GWin --> Session

    subgraph SESS ["Document Session Server — ONE authoritative owner per document"]
        direction TB
        Session["routed by consistent hash on doc_id<br/>leader-elected so exactly one owns it"]
        Seq["1 · SEQUENCER<br/>assign a monotonic version<br/>concurrency is now defined relative<br/>to a single authoritative sequence"]
        Transform["2 · TRANSFORM (OT)<br/>both based on v5:<br/>A inserts at pos 3 → v6<br/>B inserts at pos 7, based on stale v5<br/>→ A's insert is BEFORE 7,<br/>so shift B: 7 → 8, apply as v7<br/>without this the documents<br/>DIVERGE FOREVER"]
        Persist["3 · persist to append-only log"]
        Broadcast["4 · broadcast transformed op<br/>+ ack the originator"]
        Session --> Seq --> Transform --> Persist --> Broadcast
    end

    Persist --> Ops[("operations · append-only<br/>PK = doc_id, SK = version<br/>the doc is a FOLD over ops")]
    Ops --> Snap["Snapshot job every N ops<br/>load = snapshot + ops since<br/>never replay a million entries"]
    Snap --> Blob[("Snapshots · object storage")]
    Ops -. "owner dies → new owner elected,<br/>rebuilds from snapshot + ops,<br/>clients resend unacked ops" .-> Session

    Broadcast --> GWout["WS Gateway · fan-out<br/>same fleet · connection registry<br/>doc_id → connected clients"]
    Presence[("Presence · Redis, ephemeral<br/>cursors and selections · TTL<br/>deliberately LOSSY: throttled,<br/>never persisted, never ordered")] -.-> GWout

    subgraph CB ["Client B"]
        direction TB
        LocalB["Apply locally<br/>transform incoming ops against<br/>own pending buffer"]
        PendB[("Pending buffer")]
        LocalB --> PendB
    end
    GWout --> LocalB

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Ops,PendA,PendB db
    class Presence cache
    class Blob blob
    class Transform,Seq hot

    click GWout href "/docs/07-apis-and-communication" "Role: holds collaborators' connections and routes each doc to the server that owns it.<br/>Trade-off: stateful, so moving a document forces its editors to reconnect."
    click Blob href "/docs/09-specialized-building-blocks" "Role: periodic document snapshots so opening a doc doesn't replay every op.<br/>Trade-off: snapshot frequency trades storage and write cost against load time."
    click Presence href "/docs/04-caching" "Role: live cursors and selections, kept only in memory.<br/>Trade-off: deliberately lossy, so nothing survives a restart, and that's fine."
```

Each client edits its own copy immediately and syncs through the one Document Session Server that owns the document. WS Gateways carry ops in and out, and the operations log is the durable record everything else is rebuilt from.

1. Client A applies the keystroke locally at once and keeps the op, with its `base_version`, in its pending buffer. The op travels over the WebSocket to the WS Gateway, which routes it by `doc_id` to the Document Session Server that owns the document, and the sequencer there assigns it the next monotonic version.
2. If the op was based on an older version, the transform step adjusts it against the ops applied since, shifting its positions so it still lands where the user meant.
3. The session server persists the op to the append-only operations log, keyed by `doc_id` and `version`.
4. It broadcasts the transformed op through the WS Gateway, whose connection registry maps `doc_id` to connected clients, and acks Client A, which drops the op from its pending buffer.
5. Client B transforms the incoming op against its own pending buffer and applies it locally.

Two background flows keep the log usable. Every N ops, a snapshot job writes the folded document to object storage, so a load reads the latest snapshot plus the ops after it. If the owner dies, a new owner is elected, rebuilds from snapshot and ops, and clients resend their unacked ops. Presence takes its own path: cursors and selections live in Redis with a TTL and reach collaborators through the gateway, never through the operations log.

<!-- tab: At 10x · 10M sessions -->

```mermaid
flowchart TB
    Editors([Editors · up to ~100 per doc]) -- "WebSocket<br/>nearest region" --> GW["WS gateway fleet · per region"]
    Viewers([Viewers · up to 10k per doc]) -- "read-only socket" --> GW
    GW -- "ops from editors" --> Owner

    Leases[("Ownership leases · per region<br/>doc_id → session server + epoch<br/>taken on first open, dropped when idle")] -.-> Owner

    subgraph SESS ["Session server owning the doc · region nearest most editors"]
        direction TB
        Owner["SEQUENCER + TRANSFORM<br/>unchanged: one owner per doc"]
        Group["Group commit<br/>many docs' ops per log write"]
        Owner --> Group
    end

    Group --> Log[("Op log · append-only<br/>sharded by doc_id, per region")]
    Owner -- "editors: every op" --> GW
    Owner -- "viewers: batched every ~200ms" --> Topic{{"Doc topic · pub/sub<br/>gateways subscribe per doc"}}
    Topic --> GW
    Log --> Snap["Snapshot every N ops<br/>and when a doc goes idle"]
    Snap --> Blob[("Snapshots · object storage")]
    Owner -. "most editors now elsewhere →<br/>hand off: flush, release lease,<br/>new owner loads snapshot + ops" .-> Leases
    Presence[("Presence · Redis per region<br/>sampled for big audiences")] -.-> GW

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    classDef scaled stroke-dasharray:5 3
    class Log,Leases db
    class Presence cache
    class Blob blob
    class Topic queue
    class Owner hot
    class GW,Leases,Group,Log,Topic,Snap,Presence scaled

    click GW href "/docs/07-apis-and-communication" "Role: holds editor and viewer sockets in each region and subscribes to doc topics.<br/>Trade-off: stateful, so a handoff changes where ops are routed but not where sockets live."
    click Leases href "/docs/03-consistency-and-distributed-systems" "Role: maps each open doc to its owning session server, with a fencing epoch.<br/>Trade-off: a lease service to run per region, and each handoff pauses a doc briefly."
    click Owner href "/docs/03-consistency-and-distributed-systems" "Role: sequences and transforms the doc's ops, exactly as today.<br/>Trade-off: still one owner per doc, so one doc's editing rate is capped by one server."
    click Group href "/docs/02-data-storage" "Role: batches ops from many docs into one log write every few milliseconds.<br/>Trade-off: adds a few milliseconds before an op is acknowledged."
    click Log href "/docs/02-data-storage" "Role: the append-only op log, sharded by doc_id in each region.<br/>Trade-off: a cross-region handoff has to replicate the log before the new owner starts."
    click Topic href "/docs/05-async-messaging-and-event-driven" "Role: a batched op stream per doc for viewers, fanned out by the gateways.<br/>Trade-off: viewers see edits ~200ms after editors do."
    click Snap href "/docs/09-specialized-building-blocks" "Role: snapshots every N ops and whenever a doc goes idle.<br/>Trade-off: more snapshot writes for docs that are opened and closed often."
    click Presence href "/docs/04-caching" "Role: cursors per region, sampled when the audience is large.<br/>Trade-off: in a big doc you don't see everyone's cursor."
```

Same product at 10x. Documents are still independent, so raw session count is the easy part; what 10x really adds is users in every region and documents with audiences today's design never planned for. Dashed outlines mark what's new or reshaped compared with today's design.

| | Today | At 10x |
|---|---|---|
| Concurrent edit sessions | 1M | 10M |
| Documents | 1B | ~10B |
| Op rate at peak | a few M/sec | tens of M/sec |
| Largest live audience on one doc | ~50 editors | ~100 editors + 10k viewers |
| Regions | 1 | several |

**What changes, and the number that forces it**

1. **Viewers stop costing the owner.** A company-wide doc with 10k people watching would make the owning server write every op to 10k sockets. Editors still receive every op directly, but viewers read from a per-document pub/sub topic that gateways subscribe to, receiving ops batched every ~200ms. The owner's work now grows with the number of editors, not the size of the audience.
2. **Ownership lives near the editors.** With users in every region, an owner on another continent adds a long round trip to every remote edit and ack. Optimistic local application hides it while typing, but collaborators' changes arrive late. The owner runs in the region closest to most active editors and hands off when that majority moves: flush, release the lease, and the new owner loads snapshot plus ops. It's the existing failover path, run on purpose.
3. **Leases replace per-document elections.** Running leader election for each of millions of open documents is a lot of coordination. A regional lease service maps `doc_id` to a session server; ownership is taken on first open and dropped once the doc goes idle, so the ~10B mostly idle documents cost nothing. A fencing epoch on the lease keeps a paused old owner from writing after a handoff.
4. **Op writes are group-committed.** Tens of millions of ops/sec as individual appends would be tens of millions of log writes. Each session server batches ops from every document it owns into one write every few milliseconds, then acks, well inside the 200ms remote-visibility budget.
5. **Snapshots follow activity.** Snapshotting every N ops still applies, plus a snapshot whenever a doc goes idle, so the next open, possibly on a different owner in a different region, loads quickly.
6. **Presence is sampled.** Ten thousand viewer cursors is noise, not collaboration. Large audiences show editors' cursors plus a count ("and 9,400 others"), and presence stays in each region's Redis without ever crossing regions.

**What stays the same**

Edits apply locally at 0ms. There is still one authoritative sequencer per document, convergence still comes from OT (or a CRDT), the op log is still append-only and never garbage-collected, snapshots remain an optimization on top of it, and presence stays deliberately lossy. The correctness core is untouched; 10x only changes who pays for the audience and where the owner sits.

<!-- /tabs -->

---
