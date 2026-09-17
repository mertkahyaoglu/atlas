---
group: "tech"
order: 10
title: "Object storage"
role: "Blob store"
summary: "S3-style storage for bytes: effectively unlimited, extremely durable, and never in the request path."
tags: ["object-storage", "chunking", "cdn", "event-driven"]
---

# Object storage

## Basics

Object storage is an HTTP key-value store for immutable blobs. You `PUT` bytes
under a key in a bucket and `GET` them back. There are no directories — a key like
`users/123/avatar.jpg` is a flat string that merely looks like a path — no partial
updates, and no file handles.

What you buy is durability and scale that nothing else offers at the price:
roughly eleven nines of durability from erasure coding across facilities, no
capacity ceiling to plan for, and storage costs an order of magnitude below block
storage, dropping further in colder tiers. What you give up is latency (tens of
milliseconds, not microseconds) and any ability to query the contents.

Writes are atomic per object and reads are read-after-write consistent for both
new objects and overwrites. Listing a prefix is a separate, slower, paginated
operation and should never be on a user's critical path.

## Key concepts and capabilities

**Presigned URLs keep bytes out of your servers.** The application signs a URL
granting a time-limited upload or download, and the client talks to the store
directly. A 2 GB video never touches your API. This is the single most important
thing to say about object storage in an interview, because the naive design proxies
uploads through the service and falls over.

**Multipart upload** splits a large object into parts uploaded in parallel and
retried individually, then completed as one object. It is what makes resumable
uploads and chunked file sync work.

**Range requests** read a byte range without fetching the whole object — video
seeking, reading one chunk of a synced file, resuming a download.

**Events on change.** An upload can emit a notification to a queue or topic, which
is the standard trigger for asynchronous post-processing: generate thumbnails,
transcode to HLS renditions, scan for malware, extract text. The upload responds
immediately; the work happens behind it.

**Lifecycle and tiers.** Rules move objects to infrequent-access or archive tiers
after N days and delete them after M. This is how a design with petabytes of logs
stays affordable, and it is a one-line answer to "what does this cost?"

**Versioning** keeps every generation of a key, which gives you undelete and file
history almost for free.

**A CDN goes in front** of anything user-facing. Object storage is an origin, not a
delivery network.

## When to use it in an interview

Any time the design has files: profile pictures, message attachments, video, user
documents, backups, ML datasets, raw event archives. The pattern is always the
same and worth stating explicitly — **the blob goes in object storage, the metadata
goes in a database**. The row holds the id, owner, size, content type, status and
the object key; the bytes live in the bucket; nothing large ever passes through
your application.

It is also the durable floor under a data pipeline: raw events written to object
storage in Parquet, an OLAP store holding only the aggregates, and a batch job that
can recompute anything from the archive.

The wrong uses are as a database (no queries, no transactions), as a cache (too
slow), and for millions of tiny objects, where per-request cost and per-object
overhead dominate and packing them together is better.

## What interviewers push on

- **How does the upload actually work?** Client asks the API for a presigned URL, API records a pending row, client uploads directly, the bucket's event marks the row complete. Drawing that four-step flow is the answer.
- **What if the client uploads and never confirms?** The event-driven completion above, plus a lifecycle rule that cleans up orphaned objects.
- **Consistency of derived state.** A thumbnail appears seconds after the upload. Make the UI tolerate it, or block on the event.
- **Large file sync.** Chunk into fixed-size pieces, hash each one, upload only the chunks the server does not already have. Deduplication and resume both fall out of that.
- **Cost.** Storage is cheap, egress is not; a CDN in front is as much a cost decision as a latency one. Cold tiers for anything older than a month.
- **Security.** Presigned URLs expire; buckets are private by default; signed CDN URLs for paid or private media.
