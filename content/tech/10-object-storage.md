---
group: "tech"
order: 10
title: "Object storage"
role: "Blob store"
summary: "S3-style storage for bytes: effectively unlimited, extremely durable, and never in the request path."
tags: ["object-storage", "chunking", "cdn", "event-driven"]
facts:
  - label: "Model"
    value: "HTTP key-value store for immutable blobs; no directories"
  - label: "Durability"
    value: "~11 nines, from erasure coding across facilities"
  - label: "Capacity"
    value: "No ceiling to plan for; cost an order below block storage"
  - label: "Latency"
    value: "Tens of milliseconds — never in a hot request path"
  - label: "Consistency"
    value: "Read-after-write for new objects and overwrites"
  - label: "Queries"
    value: "None. Listing a prefix is slow and paginated"
capabilities:
  - title: "Presigned URLs keep bytes out of your servers"
    body: |-
      The application signs a URL granting a time-limited upload or download, and the client talks to the store directly. A 2 GB video never touches your API.

      This is the single most important thing to say about object storage in an interview, because the naive design proxies uploads through the service and falls over.
  - title: "Multipart upload and range requests"
    body: |-
      Multipart splits a large object into parts uploaded in parallel and retried individually, then completed as one object — that is what makes resumable uploads and chunked file sync work.

      Range requests read a byte range without fetching the whole object: video seeking, one chunk of a synced file, resuming a download.
  - title: "Events on change"
    body: |-
      An upload can emit a notification to a queue or topic — the standard trigger for asynchronous post-processing: thumbnails, HLS renditions, malware scanning, text extraction.

      The upload responds immediately; the work happens behind it.
  - title: "Lifecycle, tiers and versioning"
    body: |-
      Rules move objects to infrequent-access or archive tiers after N days and delete them after M. That is how a design with petabytes of logs stays affordable, and a one-line answer to "what does this cost?"

      Versioning keeps every generation of a key, which gives you undelete and file history almost for free.
  - title: "A CDN goes in front"
    body: |-
      Object storage is an origin, not a delivery network. Anything user-facing is served through a CDN, with signed URLs when it is private.
useWhen:
  - "The design has files: avatars, attachments, video, documents, backups, ML datasets, raw event archives"
  - "You want the pattern stated out loud: **blob in object storage, metadata in a database**"
  - "You need a durable floor under a pipeline: raw events in Parquet, aggregates hot, batch recompute from the archive"
avoidWhen:
  - "You need queries or transactions — it is not a database"
  - "You need microseconds — it is not a cache"
  - "There are millions of tiny objects: per-request cost and per-object overhead dominate, so pack them"
probes:
  - question: "How does the upload actually work?"
    answer: "Client asks the API for a presigned URL, the API records a pending row, the client uploads directly, and the bucket's event marks the row complete. Drawing those four steps is the answer."
  - question: "The client uploads and never confirms."
    answer: "The completion event handles the normal case; a lifecycle rule cleans up orphaned objects, and the pending row expires."
  - question: "The thumbnail is not there yet."
    answer: "Derived state lands seconds after the upload. Either the UI tolerates it, or the flow blocks on the processing event — pick one and say so."
  - question: "How do you sync a large file efficiently?"
    answer: "Chunk into fixed-size pieces, hash each one, upload only the chunks the server does not already have. Deduplication and resume both fall out of that."
  - question: "What does this cost?"
    answer: "Storage is cheap, egress is not — a CDN in front is as much a cost decision as a latency one. Cold tiers for anything older than a month."
  - question: "How do you keep private media private?"
    answer: "Buckets private by default, presigned URLs with short expiry, signed CDN URLs for paid content. A permanent public link is not a design."
---

# Object storage

## How it works

Object storage is an HTTP key-value store for immutable blobs. You `PUT` bytes
under a key in a bucket and `GET` them back. There are no directories — a key like
`users/123/avatar.jpg` is a flat string that merely looks like a path — no partial
updates, and no file handles.

What you buy is durability and scale that nothing else offers at the price. What
you give up is latency and any ability to query the contents.

## The upload flow, in four steps

```mermaid
flowchart TB
    Client([Client]) -- "1 · POST /uploads" --> API["API<br/>signs a URL, writes a pending row"]
    API -- "presigned PUT · expires in minutes" --> Client
    Client -- "2 · PUT bytes directly" --> Bucket[("Object storage<br/>quarantine prefix")]
    Bucket -- "3 · object-created event" --> Q{{"Queue"}}
    Q --> Worker["Worker<br/>scan · thumbnail · transcode"]
    Worker -- "4 · mark row ready" --> DB[("Metadata<br/>id · owner · key · status")]
    Bucket --> CDN["CDN<br/>signed URLs for private media"]

    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Bucket blob
    class Q queue
    class DB db
    class API hot
```

The bytes never pass through the application, and the row is only marked ready by
the event, so a client that dies mid-upload leaves an orphan for a lifecycle rule
rather than a broken record.

## Blob here, metadata there

```erd
# Metadata · your database
files || the row is small and queryable; the bytes are not here
+ file_id || uuid || PK
+ owner_id || uuid
+ object_key || text
+ content_type || text
+ size || bigint
+ status || pending | clean | rejected
+ created_at || timestamptz
# Bytes · object storage
bucket || immutable; versioning gives undelete, lifecycle moves it to cold tiers || S3-style
+ key || users/123/avatar.jpg
+ body || bytes
+ version_id || text
```

> The pattern is always the same, and worth stating explicitly: the blob goes in
> object storage, the metadata goes in a database, and nothing large ever passes
> through your application.
