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

<!-- tab: Today · 1 PB/day -->

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

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class MetaDB,LocalIdx db
    class Blob blob
    class Chunker,Conflict hot

    click Blob href "/docs/09-specialized-building-blocks" "Role: stores each unique chunk once, shared across all users.<br/>Trade-off: dedupe saves storage, but deletes need refcounts and lazy garbage collection."
```

Sync is split three ways: the client turns file changes into hashed chunks, the Metadata Service decides which chunks are missing and records versions, and object storage holds the bytes. Other devices find out about changes through the user's journal and a notification poke.

1. The filesystem watcher sees a change. The content-defined chunker splits the file into chunks of about 4 MB, the client hashes each one with SHA-256 and updates its local index, and then it sends the hashes with `POST /prepare`. The Metadata Service checks auth, quota and the path, and returns only the hashes it doesn't already have.
2. For those missing chunks it hands out presigned URLs, and the client uploads the bytes straight to object storage, where each chunk is stored under its `chunk_hash`.
3. The client commits the ordered chunk list. The Metadata Service writes the new version to the Metadata DB, on the user's shard, and appends an entry with the next `seq` to the user's journal.
4. The journal entry triggers the notification service, which pokes the user's other devices over long-poll or WebSocket without sending any payload.
5. Each device calls `GET /delta?cursor=last_seq`, compares the changes with its local index, downloads only the chunks it lacks, reassembles the file and advances its cursor.

The conflict branch applies to a device that edited the same file while offline. Its commit carries the base version it started from. If that is still the current version, the change is applied. If not, both files are kept: `report.docx` and `report (conflicted copy).docx`. In the background, object storage keeps a refcount on every chunk and deletes unreferenced chunks lazily.

<!-- tab: At 10x · 10 PB/day -->

```mermaid
flowchart TB
    Client["Client · content-defined chunker<br/>~4 MB chunks · SHA-256 each"] -- "1 · POST /prepare<br/>with chunk hashes" --> Meta["Metadata service · regional<br/>auth · quota · path validation"]
    Meta --> Filter{"per-shard Bloom filter<br/>chunk definitely new?"}
    Filter -- "maybe exists" --> ChunkIdx[("Chunk index<br/>sharded by hash prefix<br/>trillions of entries")]
    Filter -- "definitely new · skip lookup" --> Upload
    ChunkIdx -- "missing hashes" --> Upload["2 · presigned URLs<br/>missing chunks only"]
    Upload --> Blocks[("Owned block storage · erasure-coded<br/>hot → cold tiers by last access<br/>nearest region, replicated async")]

    Meta -- "3 · commit ordered chunk list" --> NS[("Metadata · sharded by NAMESPACE<br/>a user's private root, or one shared folder<br/>files · versions · journal together")]
    NS --> Journal["Journal per namespace<br/>seq++ on commit"]
    Journal --> Notify["Notification fleet<br/>~6B device long-polls<br/>pokes coalesced per namespace"]
    Notify --> Devices["Other devices<br/>GET /delta per namespace cursor<br/>download only missing chunks"]
    Devices --> Conflict{"commit's base version<br/>still current?"}
    Conflict -- "yes" --> Applied([applied])
    Conflict -- "no" --> Keep["KEEP BOTH<br/>conflicted copy"]

    NS -. "live chunk lists" .-> GC["Mark-and-sweep GC<br/>scan shard by shard for live chunks<br/>delete the rest after a grace period"]
    GC -.-> Blocks

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    classDef scaled stroke-dasharray:5 3
    class ChunkIdx,NS db
    class Blocks blob
    class NS hot
    class Filter,ChunkIdx,Blocks,NS,Journal,Notify,GC scaled

    click Filter href "/docs/09-specialized-building-blocks" "Role: per-shard Bloom filters that answer 'definitely new' for fresh chunks.<br/>Trade-off: false positives still cost an index lookup, but never a missed dedupe."
    click ChunkIdx href "/docs/02-data-storage" "Role: the global chunk-hash index, sharded by hash prefix.<br/>Trade-off: every prepare becomes a batch of lookups across many shards."
    click Blocks href "/docs/09-specialized-building-blocks" "Role: chunk bytes on owned, erasure-coded storage with hot and cold tiers.<br/>Trade-off: running your own storage fleet instead of renting one."
    click NS href "/docs/02-data-storage" "Role: files, versions and journal per namespace, each namespace on one shard.<br/>Trade-off: a device follows one cursor per namespace it can see."
    click Journal href "/docs/05-async-messaging-and-event-driven" "Role: a monotonic change feed per namespace.<br/>Trade-off: someone in thousands of shared folders has thousands of feeds, so pokes decide which to read."
    click Notify href "/docs/07-apis-and-communication" "Role: holds billions of device long-polls and coalesces pokes per namespace.<br/>Trade-off: millions of idle connections per server to keep alive."
    click GC href "/docs/08-reliability-and-operations" "Role: finds live chunks by scanning chunk lists, then deletes the rest after a grace period.<br/>Trade-off: space comes back days later instead of immediately."
```

Same product at 10x the data. 100x would mean more users than there are people, so this tab uses 10x the bytes and about 4x the users, with far larger shared workspaces. Dashed outlines mark what's new or reshaped compared with today's design.

| | Today | At 10x |
|---|---|---|
| Users | 500M | ~2B |
| Devices | ~1.5B | ~6B |
| Files | 100B | ~1T |
| Uploads | 1 PB/day | 10 PB/day |
| Largest shared folder | a team | a company of 100k+ people |

**What changes, and the number that forces it**

1. **Metadata shards by namespace, not by user.** Sharding by `user_id` assumed a user's files live with that user. At 10x, much of the data sits in shared folders used by tens of thousands of people at one company, and the "reference plus subscription" approach turns every commit into a fan-out across huge member lists. A namespace (a user's private root, or one shared folder) becomes the unit: its files, versions and journal live on one shard, a commit is still a single-shard transaction, and each device keeps one cursor per namespace it can see.
2. **The chunk index gets its own shards and a filter.** The global `chunks` table grows to trillions of entries and sits behind every `/prepare`. It's sharded by hash prefix (hashes are uniform, so there are no hot spots), and a Bloom filter on each shard answers "definitely new" for fresh content, so a brand-new video upload skips thousands of index lookups.
3. **Bytes move onto owned storage.** At 10 PB/day, renting object storage becomes one of the largest bills in the company. Chunks go to owned block storage with erasure coding (far less overhead than 3x replication), and chunks untouched for a year move to denser, higher-ratio codes; this is roughly the path Dropbox took with its own storage system. Uploads land in the nearest region, erasure-coded across its zones, and replicate to a second region asynchronously.
4. **Refcounts give way to mark-and-sweep.** Updating a global refcount on every commit and delete means a cross-shard write for every shared chunk, and one lost decrement leaks space while one doubled decrement deletes live data. Instead, a collector scans live chunk lists shard by shard, builds the live set, and deletes chunks that are absent from it and older than a generous grace period. It reclaims space slower, but it can only err toward keeping garbage.
5. **Notification becomes its own fleet.** ~6B devices holding long-polls means millions of idle connections per server. A dedicated notification fleet tracks which devices wait on which namespaces and coalesces pokes, so a burst of 500 commits to one team folder still produces a single poke per device.

**What stays the same**

Content-defined chunking so an edit only re-uploads the chunk it touches, content addressing by SHA-256, presigned direct uploads of missing chunks only, delta sync from a cursor, a notification that pokes rather than carries data, "keep both" on conflict, and soft deletes with a restore window. Metadata is still the hot path and bytes are still the volume problem; each just got its own dedicated scaling story.

<!-- /tabs -->

---
