---
group: "design"
order: 15
title: "Google Docs"
summary: "Many people typing into one document at once, with no perceptible lag and no lost edits."
hardPart: "Convergence. Two users edit the same sentence with no coordination. Both must end up with an identical document and neither edit may be silently lost — so last-write-wins is catastrophically wrong."
tags: ["crdt", "consistency", "websockets", "realtime"]
---

# 15 — Google Docs / Collaborative Editing

## Primary concepts and the hard part

**Concepts:** Operational Transformation (OT), CRDTs, causal consistency, WebSockets, event sourcing, optimistic local application, presence, snapshotting.

**The hard part they're probing:** convergence. Two users edit the same sentence simultaneously with no coordination. Both must end up with an identical document, neither edit may be silently lost, and neither user may see their own typing lag. Last-write-wins is catastrophically wrong here, and saying why is most of the answer.

---

## Requirements

**Functional**
- Multiple users edit the same document concurrently
- Every user's local edits apply instantly (no round-trip lag while typing)
- All users converge to the same final document
- Live cursors and selections of collaborators
- Full revision history and restore
- Offline editing that reconciles on reconnect

**Non-functional**
- Local edit latency: 0ms (optimistic application)
- Remote edit visibility: under ~200ms
- Convergence guaranteed, never silent data loss
- Documents up to ~100k characters with ~50 simultaneous editors

**Out of scope:** rich media embedding, comment threads (a separate, simpler subsystem), permissions model details.

**Scale**
```
Docs:            1B
Concurrent edit sessions: 1M
Ops per active editor:    ~5/sec while typing
Peak op rate:             a few M/sec across the fleet, but each doc
                          is independent → shard by doc_id
Op size:                  ~100B; a doc's op log can reach millions of entries
                          → SNAPSHOTS are mandatory
```
**Conclusion:** this is not a throughput problem — each document is an independent, small, low-traffic workload. It's a *correctness under concurrency* problem, and the architecture follows from that: one authoritative sequencer per document, and a convergence algorithm.

---

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

```mermaid
flowchart TB
    subgraph CA ["Client A"]
        direction TB
        TypeA["User types"]
        LocalA["APPLY LOCALLY IMMEDIATELY · 0ms<br/>never wait for the server —<br/>typing must not feel laggy"]
        PendA[("Pending buffer<br/>unacked ops + base_version")]
        TypeA --> LocalA --> PendA
    end

    subgraph CB ["Client B"]
        direction TB
        LocalB["Apply locally<br/>transform incoming ops against<br/>own pending buffer"]
        PendB[("Pending buffer")]
        LocalB --> PendB
    end

    PendA -- "WebSocket" --> GW
    GW["WS Gateway · connection registry<br/>doc_id → connected clients"]
    GW --> Session

    subgraph SESS ["Document Session Server — ONE authoritative owner per document"]
        direction TB
        Session["routed by consistent hash on doc_id<br/>leader-elected so exactly one owns it"]
        Seq["1 · SEQUENCER<br/>assign a monotonic version<br/>concurrency is now defined relative<br/>to a single authoritative sequence"]
        Transform["2 · TRANSFORM (OT)<br/>both based on v5:<br/>A inserts at pos 3 → v6<br/>B inserts at pos 7, based on stale v5<br/>→ A's insert is BEFORE 7,<br/>so shift B: 7 → 8, apply as v7<br/><br/>without this the documents<br/>DIVERGE FOREVER"]
        Persist["3 · persist to append-only log"]
        Broadcast["4 · broadcast transformed op<br/>+ ack the originator"]
        Session --> Seq --> Transform --> Persist --> Broadcast
    end

    Broadcast --> GW
    GW --> LocalB

    Persist --> Ops[("operations · append-only<br/>PK = doc_id, SK = version<br/>the doc is a FOLD over ops")]
    Ops --> Snap["Snapshot job every N ops<br/>load = snapshot + ops since<br/>never replay a million entries"]
    Snap --> Blob[("Snapshots · object storage")]

    Presence[("Presence · Redis, ephemeral<br/>cursors and selections · TTL<br/>deliberately LOSSY: throttled,<br/>never persisted, never ordered")] -.-> GW

    Ops -. "owner dies → new owner elected,<br/>rebuilds from snapshot + ops,<br/>clients resend unacked ops" .-> Session

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Ops,Blob,Presence,PendA,PendB store
    class Transform,Seq hot
```

<details>
<summary>Plain-text version of this diagram</summary>

```text
  ┌────────────────────────┐            ┌────────────────────────┐
  │      CLIENT A           │            │      CLIENT B           │
  │                         │            │                         │
  │  user types "X"         │            │  user types "Y"         │
  │        │                │            │        │                │
  │        ▼                │            │        ▼                │
  │  ┌──────────────────┐  │            │  ┌──────────────────┐  │
  │  │ APPLY LOCALLY     │  │            │  │ APPLY LOCALLY     │  │
  │  │ IMMEDIATELY (0ms) │  │            │  │ IMMEDIATELY       │  │
  │  │ ← never wait for  │  │            │  │                   │  │
  │  │   the server      │  │            │  │                   │  │
  │  └────────┬─────────┘  │            │  └────────┬─────────┘  │
  │           │             │            │           │             │
  │  ┌────────▼─────────┐  │            │  ┌────────▼─────────┐  │
  │  │ PENDING BUFFER   │  │            │  │ PENDING BUFFER   │  │
  │  │ unacked ops +    │  │            │  │                  │  │
  │  │ base_version     │  │            │  │                  │  │
  │  └────────┬─────────┘  │            │  └────────┬─────────┘  │
  └───────────┼────────────┘            └───────────┼────────────┘
               │  WebSocket                          │  WebSocket
               └──────────────┬──────────────────────┘
                               ▼
              ┌────────────────────────────────────┐
              │        WS GATEWAY (stateful)         │
              │   connection registry: doc_id →      │
              │   connected clients                  │
              └──────────────┬─────────────────────┘
                              ▼
  ┌──────────────────────────────────────────────────────────────┐
  │        DOCUMENT SESSION SERVER                                 │
  │        ⚠ ONE AUTHORITATIVE OWNER PER DOCUMENT                  │
  │        (routed by consistent hash on doc_id;                   │
  │         leader-elected so exactly one owns it)                 │
  │                                                                │
  │  ┌─────────────────────────────────────────────────────┐     │
  │  │  1. SEQUENCER — assign a total order                  │     │
  │  │     every op gets a monotonic version number.         │     │
  │  │     Concurrency is now defined relative to a single   │     │
  │  │     authoritative sequence, which is what makes       │     │
  │  │     convergence tractable at all.                     │     │
  │  └────────────────────┬────────────────────────────────┘     │
  │                        ▼                                       │
  │  ┌─────────────────────────────────────────────────────┐     │
  │  │  2. TRANSFORM (OT)                                    │     │
  │  │                                                       │     │
  │  │   Both clients based their op on version 5.           │     │
  │  │   A: insert "X" at pos 3     (arrives first → v6)     │     │
  │  │   B: insert "Y" at pos 7     (based on v5, stale)     │     │
  │  │                                                       │     │
  │  │   B's op must be TRANSFORMED against A's:             │     │
  │  │     A inserted 1 char at pos 3, which is BEFORE 7     │     │
  │  │     → shift B's position: 7 → 8                       │     │
  │  │     → apply as v7                                     │     │
  │  │                                                       │     │
  │  │   Without transformation, B's "Y" lands in the wrong  │     │
  │  │   place and the two documents DIVERGE FOREVER.        │     │
  │  └────────────────────┬────────────────────────────────┘     │
  │                        ▼                                       │
  │  ┌─────────────────────────────────────────────────────┐     │
  │  │  3. PERSIST op to append-only log                     │     │
  │  └────────────────────┬────────────────────────────────┘     │
  │                        ▼                                       │
  │  ┌─────────────────────────────────────────────────────┐     │
  │  │  4. BROADCAST transformed op to all other clients     │     │
  │  │     + ACK to the originator (with its version)        │     │
  │  └─────────────────────────────────────────────────────┘     │
  └──────────┬─────────────────────────────────┬─────────────────┘
              ▼                                 ▼
  ┌────────────────────────┐        ┌──────────────────────────┐
  │  operations (append-    │        │  PRESENCE (Redis)         │
  │  only log, Cassandra)   │        │  cursors, selections      │
  │  PK=doc_id SK=version   │        │  ephemeral, TTL, lossy    │
  └──────────┬─────────────┘        │  ← best-effort, NOT        │
              │                       │    persisted, NOT ordered  │
              │ every N ops           └──────────────────────────┘
              ▼
  ┌────────────────────────┐
  │  SNAPSHOT JOB           │
  │  fold ops → blob → S3   │
  │  load = snapshot +      │
  │         ops since       │
  │  (never replay 1M ops)  │
  └────────────────────────┘

  ═══════ CLIENT RECEIVES A REMOTE OP ═══════
   incoming op must be transformed against the client's OWN
   pending unacked ops before being applied locally.
   Transformation happens on BOTH ends — this symmetry is what
   makes everyone converge.
```

</details>

---

## Trade-offs and deep dives

**Why last-write-wins is wrong here.** If two users type into the same paragraph and you resolve by timestamp, one person's sentence silently vanishes while they're looking at it. In a document editor that's not an edge case, it's the normal flow. The requirement is that *both* edits survive and both users see the same result. That rules out every simple conflict-resolution strategy and is why OT and CRDTs exist.

**Optimistic local application is non-negotiable.** If a keystroke waits for a server round trip, typing feels broken at even 50ms of latency. So the client applies immediately, buffers the op as unacknowledged, and reconciles when the server responds. Everything else in the design exists to make that optimism safe.

**Operational Transformation, in plain terms.** Each operation carries the document version it was based on. When an op arrives based on a stale version, the server transforms it against every op that has been applied since, adjusting positions so the *intent* is preserved. An insert before your position shifts you right; a delete before your position shifts you left. The client performs the mirror-image transformation on incoming ops against its own pending buffer.

The honest caveat, worth volunteering: OT is notoriously difficult to implement correctly. The transformation functions must satisfy convergence properties (TP1/TP2) that are easy to get subtly wrong, and the number of cases grows with the richness of the operation set. Google Wave's OT implementation was famously hard. Acknowledging this is more credible than presenting OT as straightforward.

**CRDTs, the alternative.** Conflict-free Replicated Data Types assign each character a unique, densely-ordered identifier (a fractional index or a path in a tree), so operations are commutative by construction. Apply them in any order and you converge — no central sequencer, no transformation.

| | OT | CRDT |
|---|---|---|
| Needs central server | yes (sequencer) | no — works peer-to-peer |
| Metadata overhead | low (ops are small) | high (per-character IDs; tombstones for deletes never fully go away) |
| Implementation | complex transform matrix | complex data structure, but composable |
| Used by | Google Docs, Etherpad | Figma, Automerge, Yjs, most newer tools |

**The recommendation to state:** OT when a central server already exists and document size/memory matters; CRDT when you want offline-first, peer-to-peer, or simply want to avoid the transformation minefield. For a Google Docs clone with a server in the loop, either is defensible — what matters is that you can articulate the trade rather than declaring one universally better. Newer systems trend toward CRDTs because the tooling has matured.

**One authoritative owner per document.** Route all connections for a document to a single session server via consistent hashing on `doc_id`, with leader election so exactly one node owns it at a time. This gives a single point that assigns the total order. Without it, two servers could sequence conflicting ops independently and you'd need a much harder distributed agreement.

The failure question follows immediately: if that node dies, a new owner is elected and rebuilds state from the persisted op log (snapshot plus subsequent ops). Clients reconnect, send their unacked ops with base versions, and the new owner transforms and applies them. Brief unavailability for one document, and no data loss because the log is durable. Sharding by document means the blast radius is one document, not the platform.

**Snapshotting is mandatory.** A long-lived document accumulates millions of ops. Replaying all of them to open the file would take forever. Snapshot the materialized content every N ops (or on a timer), store it in object storage, and load as `snapshot + ops since snapshot`. This is standard event-sourcing practice, and forgetting it is a common gap.

**Presence is deliberately lossy.** Cursor positions update many times per second and are worthless a second later. Keep them in Redis with a TTL, broadcast at a throttled rate (a few times per second, not per keystroke), and never persist or order them. Treating presence with the same rigor as document ops would multiply your load for zero benefit — and saying so shows you're allocating engineering effort by value.

**Offline editing.** The client queues ops locally with their base version. On reconnect it sends the queue; the server transforms each against everything that happened meanwhile. This works well for short absences. For long ones the transformation chain gets expensive and the result can be semantically surprising even if technically convergent — at which point offering the user a "review changes" step is more honest than silent auto-merge. CRDTs handle this case more gracefully, which is a fair reason to prefer them if offline-first is a core requirement.

**Undo is harder than it looks.** Undo must be *local* — undoing your own last edit, not whoever edited most recently. That means maintaining a per-user undo stack whose entries are themselves transformed as other people's ops arrive, since the thing you want to undo may have moved. Worth raising as a known complexity rather than assuming it's free.

**Version history.** Falls out of the append-only log for free. Restoring a version is not a rewind — it's appending the ops that transform current state back to the target state, preserving history. Never mutate or truncate the log.

---

## Possible follow-up questions

- *Two users delete the same character simultaneously.* The second delete transforms into a no-op. Both converge; nobody sees a double-delete or an error.
- *How do you scale to 1M concurrent documents?* Trivially — documents are independent. Shard session servers by `doc_id` and scale horizontally. The per-document workload is small; the fleet just needs enough capacity to own many documents.
- *Rich text formatting, not just plain characters?* Model formatting as attributed ranges and define transformations for attribute operations. It substantially enlarges the transformation matrix, which is exactly the OT complexity problem manifesting.
- *How do you prove convergence?* Property-based testing: generate random concurrent operation sequences, apply them in every possible order across simulated clients, and assert all replicas end identical. This is how these systems are actually validated, since reasoning about the transform matrix by hand doesn't scale.
- *What if a client sends an op based on a version the server has garbage-collected?* Don't garbage-collect the op log — keep it. Snapshots are an optimization on top of it, not a replacement.
- *Comments and suggestions?* A separate, much simpler subsystem — comments anchor to a position range and only need position transformation when the document shifts, not full convergence. Distinguishing them from the core editing path shows appropriate scoping.
