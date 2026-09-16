# Dropbox / File Sync — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design Dropbox.

@you
Let me play back what I think the core is and narrow it.

A folder on each of my devices stays in sync, and the files live safely in the cloud. Questions:

1. How large can files get — are we talking multi-gigabyte videos and disk images?
2. Do we need version history and restore?
3. Sharing folders with other users, with permissions?
4. Can a device edit offline and reconcile when it comes back?
5. Real-time co-editing inside a document, like Google Docs — in or out?

@interviewer
Files can be many gigabytes. Yes to versions, sharing and offline. Co-editing is out.

@you
Then here's what I'm building, and what I'm not.

**Functional:** upload and download files and sync them across a user's devices; **sync only what changed**, not whole files; versioning and restore; sharing with permissions; offline editing reconciled on reconnect.

**Non-functional:** **bandwidth-efficient**, because a lot of this runs on mobile and metered connections. Changes reach other devices within seconds. **Durable — never lose a file**, and a failed sync must be retryable, never destructive. Large files over unreliable connections.

**Out of scope, deliberately:** real-time collaborative editing — that's a different system with different conflict semantics — and full-text search of file contents.

@interviewer
Scale?

@you
Let me estimate. I expect the high-traffic service isn't the one moving bytes.

@note · Playbook 10.1, phase 1
"Sync only what changed, not whole files" is the functional requirement that the whole design hangs from, and it's easy to leave implicit. Saying "a failed sync must be retryable, not destructive" early sets up the conflict answer.

## Estimate · 3 min · Bytes are volume, metadata is traffic

@you
- **Users:** 500M, averaging 3 devices — so ~1.5B devices.
- **Files:** ~100B.
- **Uploads:** ~1 PB a day.
- **Chunks:** ~4 MB on average, variable size — I'll explain why variable.
- **Dedupe:** the same PDFs, installers and media are everywhere, so cross-user dedupe saves roughly **50%** of storage.
- **Metadata operations:** every one of 1.5B devices constantly asks "has anything changed?", and most of the time the answer is no. That's **far more QPS than byte transfers.**

The conclusion: **bytes go to object storage and scale trivially; metadata is the hot path.** Most sync traffic is "what changed?", not file transfer. So I'll design the metadata service for QPS and the storage layer for volume, because they're different problems.

@interviewer
1 PB a day doesn't sound trivial.

@you
It's expensive, but it's not a hard *design* problem — object storage absorbs it without our involvement, and dedupe halves it. What's hard is making sure we don't upload most of that petabyte in the first place, which is the chunking story, and serving billions of cheap "anything new?" requests, which is the metadata story.

@note · Playbook 10.1, phase 2
The conclusion that splits the system in two — "metadata for QPS, storage for volume" — is more useful than any single number. Defending "1 PB a day is trivial" by pointing at what *is* hard keeps it from sounding glib.

## API and data model · 5 min · Prepare, upload what's missing, commit

@you
Six endpoints, and the first three are one upload:

- `POST /v1/files/prepare {path, chunk_hashes[]}` → `{missing_chunks[]}`. **The dedupe check.**
- `PUT <presigned URL>` — upload **only the missing chunks**, directly to storage, in parallel.
- `POST /v1/files/commit {path, chunk_hashes[], size, mtime}` → `{file_id, version}`.
- `GET /v1/delta?cursor=` → changes since the cursor. **The sync primitive.**
- `GET /v1/files/{id}/versions`.
- `POST /v1/shares {file_id, user_id, permission}`.

@you · at the whiteboard
Five tables:

| Table | Key | The point |
|---|---|---|
| `files` | PK `(user_id, file_id)` | path, size, mtime, `current_version`, `is_deleted` |
| `versions` | PK `(file_id, version)` | **`chunk_list[]`** — ordered hashes |
| `chunks` | PK **`chunk_hash`** (SHA-256) | `storage_url`, `size`, `refcount` — **global, content-addressed** |
| `devices` | PK `(user_id, device_id)` | `last_sync_cursor` |
| `journal` | PK `user_id`, SK `seq` | `file_id`, `change_type`, `version` — the delta feed |

`chunks` being global and keyed by content hash is the whole dedupe story: if anyone, anywhere, already uploaded a chunk with that hash, nobody uploads it again. And a file version is just an ordered list of hashes — so a new version that shares 99% of its chunks with the last one costs almost nothing to store.

@interviewer
Why a journal rather than comparing file trees?

@you
Diffing a whole tree of a hundred thousand files on every sync is expensive and scales with the size of the account, not the size of the change. A journal is a **monotonically increasing sequence of changes per user**. The client stores its cursor and asks "what's happened since 4,812?" It's cheap, incremental and resumable — a laptop that was off for a month makes one request, not a full tree walk. It's the same idea as a replication log.

@note · Playbook 10.1, phase 3
The prepare/upload/commit split *is* the dedupe design, expressed as an API. And "a version is an ordered list of hashes" makes versioning nearly free — worth saying before anyone asks how much history costs.

## High-level design · 10 min · The client does the chunking, the server decides what's missing

@you · drawing
A lot of this system runs on the client. Let me trace an edit.

1. The client's **filesystem watcher** sees `report.docx` change.
2. The **chunker** splits it into ~4 MB chunks, and the client **SHA-256s** each one and updates its local index.
3. `POST /prepare` with the hashes. The **metadata service** checks auth, quota and the path, and returns **only the hashes it doesn't already have**.
4. For those, it hands out **presigned URLs**, and the client uploads the bytes **directly to object storage**, keyed by hash, in parallel.
5. `POST /commit` with the ordered chunk list. The service writes a new version to the **metadata DB** — sharded by `user_id` — and appends a **journal entry** with the next `seq`.

Then propagation:

6. The journal entry triggers the **notification service**, which **pokes** the user's other devices — "something changed", with no payload.
7. Each device calls `GET /delta?cursor=last_seq`, diffs against its local index, **downloads only the chunks it lacks**, reassembles, and advances its cursor.

@interviewer
Why is the notification a poke without the change in it?

@you
It keeps the notification path tiny and stateless, and it makes a **missed notification harmless** — the next poll catches up from the cursor. The journal is the source of truth; the notification is a doorbell.

I'd also use **long-polling** rather than WebSockets here. The update rate per user is low — most devices get a handful of changes an hour — so a long-poll that returns on change or after a timeout is cheaper to run than billions of persistent bidirectional sockets, and it works through every corporate proxy.

@interviewer
Why shard metadata by user?

@you
So **all of a user's files, versions and journal entries live on one shard.** A commit — insert the version, update the file, append to the journal — is a single-shard transaction. And the delta query is a single-shard range scan on `(user_id, seq)`. Nothing on the hot path crosses shards.

@interviewer
What happens if the upload drops halfway through a 2 GB file?

@you
It costs one chunk. Uploads are **per chunk with per-chunk retry**, so a dropped connection loses at most 4 MB of progress. And resuming is trivial: the client just calls `/prepare` again, and the server says which chunks are still missing. It's inherently idempotent — uploading a chunk that already exists is a no-op by construction, because the key is its hash.

@interviewer
How do you verify integrity end to end?

@you
The hash *is* the verification. On download, recompute each chunk's SHA-256 and compare it to the hash in the chunk list. Content addressing gives end-to-end integrity checking for free — a corrupted chunk can't masquerade as a good one.

@note · Playbook 10.1, phase 4
Choosing long-poll over WebSockets *with the reason* — a low per-user update rate — is a judgment signal; picking the fancier transport by default is not. "The hash is the verification" turns a follow-up into a one-line answer because the design already covers it.

## Deep dive · 15 min · Content-defined chunking, dedupe, and conflicts

@you
The two hard parts are bandwidth — chunking and dedupe, which is what makes the product usable — and conflicts when two devices edit the same file offline. I'd start with chunking. Or would you rather begin with conflicts?

@interviewer
Chunking.

@you
The naive approach is **fixed-size chunks** — every 4 MB. It works until someone inserts a single byte at the start of a file. Every subsequent boundary shifts by one byte, every chunk's content changes, every hash changes, and we **re-upload the entire file** for a one-byte edit.

**Content-defined chunking** fixes it. A **rolling Rabin fingerprint** slides over the file, and a chunk boundary is declared wherever the hash of the current window matches a pattern — say, its low 22 bits are zero, which averages ~4 MB. Boundaries now depend on the **content**, not on offsets. Insert a paragraph, and only the chunk it lands in changes; the boundaries after it re-synchronize on the same content as before.

So one edited paragraph in a 2 GB file means uploading **~4 MB**. That's the difference between a usable product and an unusable one, and it's the single detail I'd most want to get right. Min and max chunk sizes bound the variance so a pathological file doesn't produce one giant chunk.

@interviewer
And dedupe?

@you
It happens at three levels, all from the same mechanism:

- **Within a file** — repeated blocks are stored once.
- **Across a user's versions** — v5 and v6 of a document share nearly every chunk, so **version history is nearly free**.
- **Across all users** — the same installer uploaded by 10,000 people is stored once, because the key is the content hash. That typically halves storage.

There's a privacy caveat I want to raise. Content-addressed **global dedupe leaks information**: if an attacker can observe that a chunk "already exists" — because the upload was instant — they can confirm whether a specific file exists anywhere in the system. A leaked document, say. Mitigate by scoping dedupe **per user or per organization**, or adding a **per-tenant salt** to the hash, and accept giving up some of the global savings.

@interviewer
Chunks are shared. How do you delete one?

@you
Carefully. You can't delete a chunk just because one file referencing it was deleted. Each chunk carries a **refcount**, decremented on delete, and a **background GC** removes zero-refcount chunks **after a grace period**. Lazily and conservatively — deleting a still-referenced chunk is unrecoverable data loss, so I'd always err toward retaining garbage.

And user-facing **deletes are soft**: mark deleted, keep for thirty days, then purge. People restore files constantly.

@interviewer
Two laptops edit the same file offline, then both reconnect.

@you
Every commit carries the **base version** the client edited from. The first laptop commits with base v7, the current version is v7, so it becomes v8. The second commits with base v7 too — but current is now v8. **That's a conflict.**

And the resolution is: **keep both.** `report.docx` gets the first edit, and `report (conflicted copy from Sam's laptop).docx` gets the second, and the human decides.

@interviewer
Why not last-write-wins? Or merge them?

@you
Last-write-wins **silently destroys someone's work**, which violates "never lose a file". And merging isn't possible in general — you can't merge two versions of a binary file, a spreadsheet or a Photoshop document. A clever merge algorithm that can't exist is worth less than admitting the human is the only one who can decide. The conflicted copy is ugly, but no work is ever lost.

@interviewer
A file changes while it's being uploaded.

@you
Uploading a file that's mutating produces a chunk list that describes no real version. So snapshot the file at chunk time where the OS allows it, and **detect an mtime or size change mid-upload** and restart. Nothing is committed until the chunk list is consistent.

@interviewer
Sharing — a file from user A appears in user B's tree, but they're on different shards.

@you
B's namespace stores a **lightweight reference** to A's file. And the share creates a **subscription**, so changes to that file show up in B's journal. It's a fan-out bounded by the number of collaborators — fine for a team, and it's the thing that strains first at larger scale.

@note · Playbook 10.1, phase 5
The fixed-offset failure, explained with a one-byte insert, is what makes content-defined chunking feel necessary. Raising the dedupe privacy leak unprompted shows you think about the consequences of an optimization, which is exactly what depth means here.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
At 10x, the **metadata service and journal write throughput** break first — not storage. Sharding by user already addresses most of it, as long as the delta endpoint stays a cheap indexed range scan.

Past that, four things change:

1. **Shard metadata by namespace, not user.** Company-wide shared folders make the reference-plus-subscription approach a fan-out on every commit. A namespace — a private root or one shared folder — becomes the unit, with its own journal, and devices keep a cursor per namespace.
2. **The chunk index gets its own shards and a Bloom filter**, so a fresh upload skips thousands of "does this hash exist?" lookups.
3. **Mark-and-sweep GC instead of refcounts.** A lost decrement leaks space; a doubled one deletes live data. Scanning live chunk lists can only err toward keeping garbage.
4. **Owned, erasure-coded storage**, because at 10 PB a day the storage bill is the business.

@interviewer
A new device syncs for the first time.

@you
A full delta from cursor zero, then download all chunks — but **prioritized by recency and by what the user opens first**, not alphabetically. Perceived speed matters more than total time: if the files from this week are there in two minutes, nobody minds that 2014 takes an hour.

@interviewer
500 GB folder, 256 GB laptop.

@you
**Selective sync**, so the user chooses folders, and **on-demand placeholder files** that download when opened. The metadata tree is fully synced — every file is visible — but the bytes are lazy.

@interviewer
End-to-end encryption?

@you
It **defeats cross-user dedupe entirely** — identical plaintext encrypts to different ciphertext under different keys. You can keep per-user dedupe with convergent encryption, where the key is derived from the content, but that reopens the "does this file exist" leak within whoever shares the key. It's a genuine, unavoidable trade between privacy and storage cost, and I'd name it rather than pretend there's a trick.

@you
What I'd monitor: **delta endpoint latency and QPS**, since that's the hot path; **dedupe ratio**, both for cost and because a sudden drop means a client chunking bug; bytes uploaded per change, which catches a regression back toward whole-file uploads; conflict-copy rate; journal lag from commit to notification; and GC deletions against a sampled audit, because a GC bug is silent data loss.

@you
To close: content-defined chunking so an edit uploads only what it touches, a global content-addressed chunk store that makes dedupe and versioning nearly free, a per-user journal with cursors so sync is incremental and resumable, and a notification that's only a poke. Conflicts keep both copies, deletes are soft, and garbage collection errs toward keeping data. Metadata is the hot path, bytes are the volume, and they scale separately.

@note · Playbook 10.5
"Metadata breaks first, not storage" repeats the estimate's conclusion at the end, which makes the design feel derived. Monitoring bytes-per-change is a specific, non-obvious metric that shows you'd catch the one regression that makes the product unusable.
