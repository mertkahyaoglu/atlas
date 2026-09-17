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
capabilities:
  - title: "You can only query by key"
    body: |-
      `GetItem` by exact key, and `Query` on one partition key plus a sort-key condition. `Scan` reads the entire table and is the wrong answer in an interview unless you are doing an offline migration.

      Everything else is an index you decided on in advance.
  - title: "Indexes"
    body: |-
      A **global secondary index** is a separate copy of the table with a different key, updated asynchronously — eventually consistent, with its own cost.

      A **local secondary index** keeps the partition key, changes the sort key, is strongly consistent, and must exist when the table is created.
  - title: "Conditional writes are the concurrency primitive"
    body: |-
      `PutItem` with `attribute_not_exists(pk)` is an atomic insert-if-absent — an idempotency key, a username claim, a distributed lock.

      `UpdateItem` with a `ConditionExpression` gives optimistic concurrency (`version = :expected`) and atomic counters (`ADD count :n`). `TransactWriteItems` is all-or-nothing across up to 100 items, at twice the cost.
  - title: "Streams"
    body: |-
      Every change can be published to a **DynamoDB Stream**, ordered per partition key and retained 24 hours.

      That is the hook for change data capture: fan out to a search index, maintain an aggregate, trigger a Lambda. It is how you avoid dual writes.
  - title: "The managed extras"
    body: |-
      **TTL** deletes expired items in the background for free — sessions, carts, rate-limit buckets. **DAX** is a write-through cache in front when microseconds matter. **Global tables** replicate multi-region with last-writer-wins.
useWhen:
  - "Access is by a key you know at design time: profiles, sessions, carts, device state, short-link mappings, metadata beside an S3 blob"
  - "Scale is large or spiky and you would rather not talk about operations at all"
  - "The interviewer has framed the problem on AWS"
  - "You want the properties of Cassandra without the operational story"
avoidWhen:
  - "Queries are ad hoc or analytical"
  - "Joins or multi-entity transactions are the norm rather than the exception"
  - "The dataset is small enough that Postgres is simply less thinking"
probes:
  - question: "Traffic is concentrated on one partition key and you are being throttled. The table has capacity."
    answer: "Hot partition. Add a suffix to spread the key, or bucket by time. Adaptive capacity helps, but it is not a design."
  - question: "What are your partition key and sort key, and which query does each index serve?"
    answer: "Expect this one every time. Describing a query you have no index for is the classic miss."
  - question: "You read from a GSI right after the write. Is it there?"
    answer: "Maybe not — a GSI is updated asynchronously. A flow that depends on seeing its own write must read the base table, or be designed differently."
  - question: "Strong or eventual for this read?"
    answer: "Say which each path uses and why. Defaulting everything to strong doubles the bill for no reason."
  - question: "How do you make this endpoint exactly-once?"
    answer: "A conditional write on an idempotency key — `attribute_not_exists` — not a lock."
  - question: "What does a million writes a day cost, and why is a `Scan` expensive?"
    answer: "Reason in request units out loud: a write unit is 1 KB, a read unit is 4 KB eventually consistent, and a `Scan` pays for every item it touches, not the ones it returns."
---

# DynamoDB

## How it works

DynamoDB is a managed key-value and document store. You do not run nodes, choose a
replication factor or plan a resharding: you declare a key and a capacity mode,
and it holds single-digit millisecond latency whether the table has a thousand
items or a trillion.

Every item lives under a **partition key** and, optionally, a **sort key**. The
partition key is hashed to place the item; the sort key orders items inside that
partition and is what makes range queries possible. Data is replicated across
three availability zones, so a read is either **eventually consistent** (the
default, cheaper, may be a moment stale) or **strongly consistent** (reads the
leader replica, costs twice as much).

```mermaid
flowchart TB
    App([Service]) -- "Query PK=USER#123" --> Router{"Hash the partition key"}
    Router --> P1["Partition 1<br/>leader + 2 replicas"]
    Router --> P2["Partition 2"]
    Router --> P3["Partition 3<br/>hot key → throttled"]
    P1 -- "changes" --> Stream{{"DynamoDB Stream<br/>ordered per key · 24h"}}
    Stream --> Index[("Search index / aggregate<br/>no dual write")]

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Index db
    class Stream queue
    class P3 hot
```

Capacity comes in two modes. **On-demand** bills per request and absorbs spikes
with no configuration. **Provisioned** reserves read and write units and is
cheaper for steady, predictable traffic; auto-scaling adjusts it over minutes, not
seconds.

## Single-table design, in one picture

Because there are no joins, related entities are packed into one table with a
composite key scheme, so a single `Query` returns a user and their recent orders
in one round trip. It reads strangely, and it is the idiomatic pattern.

```erd
# One table, several entity types
app_table || PK=USER#123 with SK between ORDER# and ORDER#~ returns the user's orders in one Query || DynamoDB
+ PK || text || PK
+ SK || text || SK
+ type || USER | ORDER | SESSION
+ attributes || document
+ ttl || epoch seconds || null
# Item shapes it holds
examples || the same table, three key patterns
+ USER#123 / PROFILE || the profile item
+ USER#123 / ORDER#2026-01-02 || one order, sorted by date
+ ORDER#987 / ITEM#3 || a line item under its order
```

## Where it fits in a design

The comparison worth having ready is with Cassandra: the same wide-column shape
and the same hot-partition risk, but managed, with conditional writes and
transactions built in, and a hard 400 KB item limit.

> "Key-based access, spiky traffic, and I would rather spend the interview on the
> access patterns than on running a ring" is the sentence that earns it.
