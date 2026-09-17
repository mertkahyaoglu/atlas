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
concepts:
  - "**Presigned URLs** — the client uploads and downloads directly, so a 2 GB video never touches your API"
  - "**Multipart upload** — parts in parallel, retried individually, completed as one object; this is what makes resume work"
  - "**Range requests** — read a byte range without fetching the object: video seeking, one chunk of a file, resuming"
  - "**Events on change** — an upload emits a notification, which is the standard trigger for scanning and transcoding"
  - "**Lifecycle rules** move objects to colder tiers after N days and delete them after M — the whole cost answer"
  - "**Versioning** keeps every generation of a key, which gives undelete and file history almost free"
  - "**Blob here, metadata there** — the row holds id, owner, key, size and status; the bucket holds the bytes"
  - "**A CDN goes in front** of anything user-facing: object storage is an origin, not a delivery network"
  - "**Not a database, not a cache** — no queries, no transactions, and tens of milliseconds per request"
---

# Object storage

## Use cases

### Uploads that never touch your servers

The one thing to say about object storage in an interview. The API signs a URL
and records a pending row, the client `PUT`s the bytes directly, and the bucket's
own event marks the row ready — so a client that dies mid-upload leaves an orphan
for a lifecycle rule rather than a broken record.

```mermaid
flowchart TB
    Client([Client]) -- "1 · POST /uploads" --> API["API<br/>signs a URL, writes a pending row"]
    API -- "presigned PUT · expires in minutes" --> Client
    Client -- "2 · PUT bytes directly" --> Bucket[("Object storage<br/>quarantine prefix")]
    Bucket -- "3 · object-created event" --> Q{{"Queue"}}
    Q --> Worker["Worker<br/>scan · thumbnail · transcode"]
    Worker -- "4 · mark row ready" --> DB[("Metadata")]

    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Bucket blob
    class Q queue
    class DB db
    class API hot
```

### Metadata you can query, bytes you cannot

The split that shows up in every file design. Everything the application filters,
sorts or authorises on lives in a row; the bytes live under a key that the row
points at.

```erd
# Metadata · your database
files || small, queryable, and the only thing the API reads on a list
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

### Syncing a large file by chunks

Hash fixed-size chunks on the client, ask which ones the server is missing, and
upload only those. Deduplication across users, resume after a dropped connection
and cheap versioning all fall out of the same content-addressed store.

```mermaid
flowchart TB
    C([Client]) -- "1 · hash chunks<br/>send the list" --> API["API"]
    API -- "2 · missing: 3 of 40" --> C
    C -- "3 · PUT only those chunks" --> Bucket[("Chunk store<br/>key = content hash")]
    C -- "4 · commit the chunk list" --> DB[("Version row<br/>ordered hashes")]
    DB -. "another user uploads the same file<br/>→ zero chunks to send" .-> Bucket

    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Bucket blob
    class DB db
    class API hot
```

### Serving the bytes, and ageing them out

Object storage is an origin. A CDN serves users, signed URLs keep private media
private, and lifecycle rules move cold objects down the tiers — which is the
one-line answer to what a petabyte of logs costs.

```mermaid
flowchart TB
    User([Viewer]) --> CDN["CDN edge<br/>signed URL, short expiry"]
    CDN -- "miss" --> Bucket[("Object storage<br/>standard tier")]
    Bucket -- "after 30 days" --> IA[("Infrequent access")]
    IA -- "after 180 days" --> Archive[("Archive tier<br/>minutes to restore")]
    Archive -- "after 7 years" --> Gone["Deleted by rule"]

    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Bucket,IA,Archive blob
    class CDN hot
```
