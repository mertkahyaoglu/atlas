---
group: "design"
order: 12
title: "Dropbox / File Sync"
summary: "Syncing files across devices without re-uploading a two gigabyte file because one paragraph changed."
hardPart: "Bandwidth efficiency through content-defined chunking and delta sync — plus a coherent story for two clients that edited the same file offline."
tags: ["chunking", "dedup", "object-storage", "consistency"]
hardPartDetail: "Bandwidth efficiency. Re-uploading a 2 GB file because someone changed one paragraph is the naive design. They want chunking, hashing, and delta sync — plus a coherent story for what happens when two clients edit offline and both come back."
concepts:
  - "content-defined chunking"
  - "deduplication"
  - "delta sync"
  - "object storage"
  - "metadata vs bytes separation"
  - "versioning"
  - "conflict resolution"
  - "long-polling/notification for sync"
  - "Merkle-style hashing"
requirements:
  functional:
    - "Upload/download files, sync across a user's devices"
    - "Sync only what changed (not whole files)"
    - "File versioning and restore"
    - "Share files/folders with other users, with permissions"
    - "Work offline; reconcile on reconnect"
  nonFunctional:
    - "Bandwidth-efficient (mobile, metered connections)"
    - "Sync latency: changes propagate to other devices within seconds"
    - "Durable: never lose a file. Availability high but a failed sync must be retryable, not destructive"
    - "Support large files (GBs) over unreliable connections"
  outOfScope: "real-time collaborative editing (that's design 15), full-text search of contents."
scale:
  numbers: |-
    Users:            500M, avg 3 devices
    Files:            100B files
    Daily uploads:    1 PB/day
    Dedupe savings:   ~50% cross-user (same PDFs, installers, media everywhere)
    Chunk size:       ~4 MB average (variable, content-defined)
    Metadata ops:     far higher QPS than byte transfers — the metadata service
                      is the real high-traffic service
  conclusion: "Bytes go to object storage and scale trivially; **metadata is the hot path**. Most sync traffic is \"what changed?\" polling, not file transfer. Design the metadata service for QPS and the storage layer for volume — they're different problems."
tradeoffs:
  - title: "Content-defined chunking is the central idea"
    body: |-
      With fixed-size chunks, inserting a single byte at the start of a file shifts every subsequent boundary, so every chunk hash changes and you re-upload the entire file. Content-defined chunking (a rolling Rabin fingerprint that declares a boundary when the hash of a sliding window matches a pattern) makes boundaries depend on *content*, so an insertion only disturbs the chunk it lands in. One edited paragraph in a 2 GB file means uploading ~4 MB. This is the difference between a usable product and an unusable one, and it's the single detail most worth getting right in this interview.
  - title: "Deduplication operates at three levels"
    body: |-
      - *Within a file*: repeated blocks stored once.
      - *Across a user's versions*: v5 and v6 of a document share nearly all chunks, so versioning is nearly free.
      - *Across all users*: the same Ubuntu ISO uploaded by 10,000 people is stored once, because the key is the content hash.

      Global dedupe typically halves storage. The privacy caveat worth raising: content-addressed global dedupe leaks information — an attacker who can observe "this chunk already exists" can confirm whether a specific file exists in the system. Mitigate by scoping dedupe per user or per organization, or by adding a per-tenant salt to the hash. Raising this unprompted is a strong signal, because it shows you think about the security consequences of an optimization.
  - title: "Metadata and bytes scale separately"
    body: |-
      The metadata service handles far more QPS than the byte pipeline (every client polls for deltas constantly, but most polls find nothing). Shard metadata by `user_id` so all of a user's files, versions, and journal entries live on one shard, making a commit a single-shard transaction and the delta query a single-shard range scan. Bytes go to object storage, which scales without your involvement.
  - title: "The journal is the sync primitive"
    body: |-
      Rather than diffing whole file trees, each user has a monotonically increasing sequence of changes. A client stores its cursor and asks "what's happened since N?" This is cheap, incremental, and resumable — a client that's been offline for a month makes one request, not a full tree walk. It's the same idea as a replication log.
  - title: "Notification is a poke, not a payload"
    body: |-
      The notification service tells devices "something changed"; the device then pulls the delta. This keeps the notification path tiny and stateless, and means a missed notification is harmless — the next poll catches up. Long-polling is usually sufficient and cheaper than WebSockets here, since the update rate per user is low. Choosing long-poll over WebSockets *with that reasoning* is a good judgment signal.
  - title: "Conflict resolution: keep both, always"
    body: |-
      You cannot merge two versions of a binary file, and silently picking a winner destroys someone's work. Detect conflicts by having the client send the base version it edited from; if the server's current version differs, it's a conflict. Then create a conflicted copy with both preserved and let the human decide. Last-write-wins is the wrong answer here and saying why is worth more than proposing a clever merge algorithm that can't exist.
  - title: "Uploads are direct, parallel, and resumable"
    body: |-
      Presigned URLs so bytes never traverse your servers, parallel chunk uploads to saturate bandwidth, and per-chunk retry so a dropped connection costs one chunk rather than the whole file. The client can also resume by re-running `/prepare` — the server tells it which chunks are still missing, which is inherently idempotent.
  - title: "Reference counting and garbage collection"
    body: |-
      Chunks are shared, so you cannot delete a chunk when one file referencing it is deleted. Maintain a refcount, decrement on delete, and run a background GC for zero-refcount chunks after a grace period. Do the deletion lazily and conservatively — deleting a still-referenced chunk is unrecoverable data loss, so err toward retaining garbage.
  - title: "Deletes must be soft"
    body: |-
      Mark deleted, keep for 30 days, then purge. Users restore files constantly, and an immediate hard delete of a chunk that's still referenced by an old version is catastrophic.
  - title: "Sharing crosses shard boundaries"
    body: |-
      A file shared from user A to user B lives on A's shard but must appear in B's tree. Store a lightweight reference in B's namespace pointing at A's file, and include shared-file changes in B's journal by having the share create a subscription. This is a fan-out problem again, bounded by the number of collaborators.
  - title: "Bandwidth-adjacent optimizations"
    body: |-
      Compress chunks before upload where the content is compressible (skip already-compressed formats — detect by entropy or extension). Use a CDN for downloads of widely-shared files. Throttle background sync so it doesn't saturate a user's connection while they're working.
followUps:
  - question: "How does a new device do its first sync?"
    answer: "Full delta from cursor 0, then download all chunks. Prioritize by recency and by what the user opens first (\"streaming\" the sync) rather than strict alphabetical order — perceived speed matters more than total time."
  - question: "A user has a 500 GB folder and a laptop with 256 GB."
    answer: "Selective sync (choose folders) and on-demand/placeholder files that download on open. The metadata tree is fully synced; the bytes are lazy."
  - question: "How do you handle a file being edited while uploading?"
    answer: "Snapshot or lock the file at chunk time, detect mtime/size change mid-upload, and restart. Uploading a file that's mutating produces a corrupt chunk list."
  - question: "Very large files (50 GB)?"
    answer: "Same mechanism; the chunk list itself gets large, so store it separately (or as a Merkle tree) rather than inline in the version row."
  - question: "How do you verify integrity?"
    answer: "The chunk hash *is* the verification — recompute on download and compare. Content addressing gives you end-to-end integrity checking for free."
  - question: "What breaks first at 10x?"
    answer: "The metadata service and journal write throughput, not storage. Mitigate with sharding by user (which is already the design) and by ensuring the delta endpoint is a cheap indexed range scan."
  - question: "End-to-end encryption?"
    answer: "Client-side encryption defeats cross-user dedupe entirely (identical plaintext encrypts to different ciphertext under different keys). You can keep per-user dedupe with convergent encryption, but you lose the global savings. A genuine, unavoidable trade-off worth naming."
---
# 12 — Dropbox / Google Drive (File Sync)

## API / Model

```api
POST /v1/files/prepare || {path, chunk_hashes[]} || 200 {missing_chunks[]} || dedupe check
PUT <presigned url> || || 200 || upload only the missing chunks, in parallel
POST /v1/files/commit || {path, chunk_hashes[], size, mtime} || 201 {file_id, version}
GET /v1/delta?cursor= || || 200 changes since cursor || the sync primitive
GET /v1/files/{id}/versions || || 200 version list
POST /v1/shares || {file_id, user_id, permission} || 201
```

```schema
files || PK: (user_id, file_id) || path, size, mtime, current_version, is_deleted, parent_folder_id ||
versions || PK: (file_id, version) || chunk_list[] (ordered hashes), created_at, created_by, size ||
chunks || PK: chunk_hash || storage_url, size, refcount || SHA-256 of the content; global, content-addressed, shared across all users
devices || PK: (user_id, device_id) || last_sync_cursor, last_seen ||
journal || PK: user_id SK: seq || file_id, change_type, version, ts || monotonic seq; the delta feed clients read from
```

The `chunks` table being global and keyed by content hash is the whole dedupe story: if any user anywhere has already uploaded a chunk with that hash, nobody uploads it again.

---

## High-level architecture

```mermaid
flowchart TB
    subgraph CLIENT ["Client · desktop or mobile"]
        direction TB
        Watcher[Filesystem watcher]
        Chunker["CONTENT-DEFINED CHUNKER<br/>Rabin fingerprint, not fixed offsets<br/>edit one paragraph → only that<br/>~4 MB chunk changes, not the whole file"]
        Hasher["SHA-256 each chunk"]
        LocalIdx[("Local index · path → chunks")]
        Watcher --> Chunker --> Hasher --> LocalIdx
    end

    Hasher -- "1 · POST /prepare<br/>with chunk hashes" --> Meta
    Meta["METADATA SERVICE<br/>which hashes exist already?<br/>returns ONLY the missing ones<br/>← dedupe happens here<br/>auth · quota · path validation"]
    Meta -- "2 · presigned URLs<br/>missing chunks only" --> Blob[("Object storage · key = chunk_hash<br/>content-addressed: an identical<br/>chunk is stored ONCE globally<br/>refcounted, GC'd lazily")]
    Meta --> MetaDB[("Metadata DB · sharded by user_id<br/>files · versions · chunks · journal<br/>all of a user's data on one shard")]
    Meta -- "3 · commit ordered<br/>chunk list" --> Journal["Append to user's JOURNAL<br/>seq++ · file_id · version"]

    Journal --> Notify["Notification service<br/>long-poll or WS per device<br/>a POKE with no payload —<br/>a missed one is harmless"]
    Notify --> Devices["Other devices<br/>GET /delta?cursor=last_seq<br/>diff against local index<br/>download ONLY missing chunks<br/>reassemble · advance cursor"]
    Devices --> Conflict{"both edited offline?<br/>commit carries BASE VERSION"}
    Conflict -- "base = current" --> Applied([applied])
    Conflict -- "base ≠ current" --> Keep["KEEP BOTH<br/>report.docx and<br/>'report (conflicted copy).docx'<br/>never silently discard work"]

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Blob,MetaDB,LocalIdx store
    class Chunker,Conflict hot

    click Blob href "/docs/09-specialized-building-blocks" "Role: stores each unique chunk once, shared across all users.<br/>Trade-off: dedupe saves storage, but deletes need refcounts and lazy garbage collection."
```

<details>
<summary>Plain-text version of this diagram</summary>

```text
  ┌─────────────────────────────────────────────────────────────────┐
  │                        CLIENT (desktop/mobile)                    │
  │                                                                   │
  │  ┌──────────────┐   file changed on disk                          │
  │  │ WATCHER      │────────────────┐                                │
  │  │ (fs events)  │                 ▼                               │
  │  └──────────────┘   ┌────────────────────────────────────┐        │
  │                      │  CHUNKER — content-defined boundary│        │
  │                      │  (Rabin fingerprint, not fixed     │        │
  │                      │   offsets)                          │        │
  │                      │                                     │        │
  │                      │  FIXED-SIZE (naive):                │        │
  │                      │   insert 1 byte at start →          │        │
  │                      │   [c1][c2][c3][c4] ALL SHIFT →      │        │
  │                      │   every chunk hash changes → re-    │        │
  │                      │   upload entire file. BAD.          │        │
  │                      │                                     │        │
  │                      │  CONTENT-DEFINED:                   │        │
  │                      │   boundaries follow CONTENT, so     │        │
  │                      │   [c1][c2'][c3][c4] — only c2       │        │
  │                      │   changes. Upload 1 chunk. GOOD.    │        │
  │                      └────────────┬───────────────────────┘        │
  │                                    ▼                                │
  │                      ┌────────────────────────────────────┐        │
  │                      │  HASH each chunk (SHA-256)          │        │
  │                      └────────────┬───────────────────────┘        │
  │  ┌──────────────┐                 │                                │
  │  │ LOCAL INDEX  │◄────────────────┘                                │
  │  │ path→chunks  │                                                   │
  │  └──────────────┘                                                   │
  └────────────────────────────┬────────────────────────────────────────┘
                                │ 1. POST /prepare  {chunk_hashes[]}
                                ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                      METADATA SERVICE                              │
  │   · which of these hashes do we already have?                      │
  │   · returns ONLY the missing ones  ← DEDUPE HAPPENS HERE           │
  │   · authorization, quota, path validation                          │
  └───────┬──────────────────────────────────────────┬────────────────┘
           │ 2. presigned URLs for missing chunks only │
           ▼                                            ▼
  ┌──────────────────────────┐              ┌─────────────────────────┐
  │  OBJECT STORAGE (S3)      │              │  METADATA DB            │
  │  key = chunk_hash          │              │  files / versions /     │
  │  content-addressed →       │              │  chunks / journal       │
  │  identical chunk stored    │              │  sharded by user_id     │
  │  ONCE globally             │              │  (all of a user's data  │
  │                            │              │   on one shard = cheap  │
  │  client uploads DIRECTLY,  │              │   transactional deltas) │
  │  in parallel, resumable    │              └───────────┬─────────────┘
  └──────────────────────────┘                            │
           │ 3. POST /commit {ordered chunk list}         │
           └───────────────────────┬──────────────────────┘
                                    ▼
                        ┌───────────────────────────┐
                        │  append to user's JOURNAL  │
                        │  seq++ , file_id, version  │
                        └────────────┬──────────────┘
                                      ▼
                        ┌───────────────────────────┐
                        │  NOTIFICATION SERVICE      │
                        │  long-poll or WS per device│
                        │  "you have changes"        │
                        │  (no payload — just a poke)│
                        └────────────┬──────────────┘
                                      ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                      OTHER DEVICES                                 │
  │   GET /delta?cursor=<last_seq>                                     │
  │     → list of changed files + their chunk lists                    │
  │   diff against LOCAL index → determine missing chunks              │
  │   download ONLY those chunks from CDN/object storage               │
  │   reassemble → write to disk → advance cursor                      │
  └──────────────────────────────────────────────────────────────────┘

  ═══════════════ CONFLICT (both edit offline) ═══════════════

   Device A (offline)          Device B (offline)
    edits report.docx           edits report.docx
         │                            │
         └──────── both reconnect ────┘
                       ▼
        ┌──────────────────────────────────┐
        │ commit carries BASE VERSION       │
        │ first to arrive wins → v5          │
        │ second's base (v4) ≠ current (v5)  │
        │   → CONFLICT                       │
        │                                    │
        │ Resolution: KEEP BOTH              │
        │   report.docx            (v5)      │
        │   report (B's conflicted copy).docx│
        │                                    │
        │ ⚠ Never silently discard a user's  │
        │   work. Merging arbitrary binaries │
        │   is impossible; surfacing both is │
        │   the only honest answer.          │
        └──────────────────────────────────┘
```

</details>

---
