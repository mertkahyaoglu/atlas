---
group: "tech"
order: 5
title: "DynamoDB"
role: "Managed KV store"
summary: "Key-value and document storage with flat latency at any size, as long as you design for the key."
tags: ["dynamodb", "sharding", "idempotency", "consistency", "caching"]
facts:
  - label: "Model"
    value: "Partition key, optional sort key; items up to 400 KB"
  - label: "Latency"
    value: "Single-digit milliseconds at a thousand items or a trillion"
  - label: "Reads"
    value: "Eventually consistent by default; strongly consistent costs twice"
  - label: "Capacity"
    value: "On-demand absorbs spikes; provisioned is cheaper when steady"
  - label: "Concurrency"
    value: "Conditional writes, and transactions across up to 100 items"
  - label: "Change feed"
    value: "Streams, ordered per partition key, kept 24 hours"
concepts:
  - "**Query by key only** — `GetItem` by exact key, `Query` on a partition key plus a sort-key condition; `Scan` is the wrong answer"
  - "**Indexes are decided up front** — a GSI is a second copy with its own key, updated asynchronously; an LSI is strongly consistent"
  - "**Single-table design** — `PK=USER#123`, `SK=ORDER#…` packs related entities so one `Query` returns them together"
  - "**Conditional writes** — `attribute_not_exists` for insert-if-absent, `version = :expected` for optimistic concurrency"
  - "**Transactions** — `TransactWriteItems` is all-or-nothing across up to 100 items, at twice the cost"
  - "**Streams** — every change published in order per key, which is how you avoid dual writes"
  - "**TTL** deletes expired items in the background for free: sessions, carts, rate-limit buckets"
  - "**Hot partitions throttle** even when the table has capacity — spread the key or bucket by time"
  - "**Cost is request units** — a write unit is 1 KB, a read unit 4 KB eventually consistent; reason in those out loud"
---

# DynamoDB

## Use cases

### One table, one round trip

There are no joins, so related entities are packed under one partition key and
retrieved together: `PK=USER#123` with a sort key range between `ORDER#` and
`ORDER#~` returns the profile and the recent orders in a single `Query`. It reads
strangely and it is the idiomatic pattern.

```erd
# One table, several entity types
app_table || one Query returns a user and their orders; the SK prefix is the entity type || DynamoDB
+ PK || text || PK
+ SK || text || SK
+ type || USER | ORDER | SESSION
+ attributes || document
+ ttl || epoch seconds || null
# The key patterns it holds
examples || same table, three shapes
+ USER#123 / PROFILE || the profile item
+ USER#123 / ORDER#2026-01-02 || one order, sorted by date
+ ORDER#987 / ITEM#3 || a line item under its order
```

### Exactly-once without a lock

A conditional write is the concurrency primitive: `PutItem` with
`attribute_not_exists(pk)` succeeds for the first caller and fails for every
retry, which is an idempotency key, a username claim or a lock, depending on what
you put in the key.

```mermaid
flowchart TB
    R1([Request · key abc]) -- "PutItem attribute_not_exists(pk)" --> T["app_table"]
    T -- "200 · first writer wins" --> R1
    R2([Retry · same key abc]) -- "same conditional put" --> T
    T -. "ConditionalCheckFailed<br/>return the stored result" .-> R2
    R3([Update · version = 7]) -- "UpdateItem ConditionExpression" --> T
    T -. "someone else wrote version 8<br/>read and retry" .-> R3

    classDef hot stroke:#e8a33d,stroke-width:2px
    class T hot
```

### Fanning changes out with Streams

Every change can be published in order per partition key and kept for 24 hours.
That stream is how a search index, an aggregate or a notification is driven from
the table without the application writing to two places and getting them out of
step.

```mermaid
flowchart TB
    App([Service]) -- "PutItem" --> T["app_table"]
    T --> S{{"DynamoDB Stream<br/>ordered per key · 24h"}}
    S --> L["Lambda / consumer<br/>idempotent"]
    L --> ES[("Search index")]
    L --> Agg[("Aggregate table")]
    L -. "consumer down > 24h<br/>rebuild from the table" .-> T

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class ES,Agg db
    class S queue
    class T hot
```

### Spreading a hot partition

Traffic concentrated on one partition key is throttled even though the table has
capacity, because a partition has its own ceiling. The fix is in the key: add a
suffix and fan the reads across it, or bucket by time so today's writes are not
all one key.

```mermaid
flowchart TB
    Write([Writes · one popular key]) -- "PK=POST#42" --> P1["Partition<br/>throttled"]
    Write2([Writes · spread]) -- "PK=POST#42#n<br/>random suffix" --> P2["Partition A"]
    Write2 --> P3["Partition B"]
    Write2 --> P4["Partition C"]
    Read([Read the total]) -. "query all 10 suffixes<br/>and sum" .-> P2

    classDef hot stroke:#e8a33d,stroke-width:2px
    class P1 hot
```
