---
group: "tech"
order: 1
title: "PostgreSQL"
role: "Relational store"
summary: "The relational default: transactions, joins and constraints on one primary, until scale forces you off it."
tags: ["postgres", "consistency", "concurrency", "replication", "sharding"]
facts:
  - label: "Model"
    value: "Relational rows, SQL, joins and constraints"
  - label: "Consistency"
    value: "ACID; MVCC snapshots, read committed by default"
  - label: "Writes"
    value: "One primary — name that ceiling before you're asked"
  - label: "Reads"
    value: "Streaming replicas, usually milliseconds behind"
  - label: "Indexes"
    value: "B-tree, GIN, GiST, BRIN; partial and covering"
  - label: "More than rows"
    value: "JSONB documents, PostGIS geo, full-text search"
concepts:
  - "**WAL first** — every write is an append plus an `fsync` before any data page moves; replicas and CDC both read that log"
  - "**MVCC** — an update writes a new row version, so readers never block writers; `VACUUM` reclaims the dead ones"
  - "**Read committed by default** — a fresh snapshot per statement, which does *not* prevent lost updates"
  - "**Row locks** — `SELECT … FOR UPDATE` holds a row for the transaction; `SKIP LOCKED` turns a table into a work queue"
  - "**Constraints are correctness** — a `UNIQUE` index on an idempotency key is the cheapest exactly-once there is"
  - "**Indexes** — B-tree by default, GIN for JSONB and full-text, GiST for ranges and geometry, BRIN for append-only data"
  - "**More than a row store** — JSONB documents, PostGIS radius queries, full-text search good to a few million documents"
  - "**Replication** — async by default, `synchronous_commit` trades write latency for no acknowledged loss"
  - "**Logical decoding** — the WAL as a change stream, which is how derived stores stay in sync without dual writes"
  - "**Connections are processes** — past a few hundred, put PgBouncer in front"
  - "**Scaling path** — vertical, then read replicas, then partitioning, then sharding; stop where the numbers stop"
---

# PostgreSQL

## Use cases

### Orders and money, in one transaction

The reason to reach for Postgres first. An order row and its payment attempt are
written in the same transaction, so a crash between them is impossible, and the
`UNIQUE (order_id, idempotency_key)` index means a retried checkout returns the
original result instead of charging twice.

```erd
# Orders · Postgres
orders || one row per order; the state column only moves forward
+ order_id || bigint || PK
+ customer_id || bigint || → customers
+ state || pending | paid | refunded
+ total_minor_units || bigint
+ created_at || timestamptz
customers
+ customer_id || bigint || PK
+ email || citext
+ UNIQUE (email)
# Payments
payment_attempts || the UNIQUE key is the whole idempotency mechanism
+ attempt_id || bigint || PK
+ order_id || bigint || → orders
+ idempotency_key || uuid
+ psp_ref || text || null
+ state || text
+ UNIQUE (order_id, idempotency_key)
```

### Read scaling, and the read-after-write trap

Reads scale out on replicas; writes do not. The catch is the user who posts and
immediately reloads: their own write may not have arrived on the replica yet.
Route that one read to the primary, or return the write's own result.

```mermaid
flowchart TB
    App([Application]) -- "writes" --> PG["Primary<br/>the only writer"]
    PG -- "streams the WAL" --> R1[("Replica 1<br/>ms behind")]
    PG -- "streams the WAL" --> R2[("Replica 2")]
    App -- "ordinary reads" --> R1
    App -- "ordinary reads" --> R2
    App -- "read-after-write<br/>pin to the primary" --> PG

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class R1,R2 db
    class PG hot
```

### A work queue, without a queue

`SELECT … FOR UPDATE SKIP LOCKED` lets several workers drain one table safely:
each claims rows nobody else holds, and a worker that dies rolls back and the
rows become claimable again. Good enough for outbox rows, scheduled emails and
retries — and one fewer system than Kafka.

```mermaid
flowchart TB
    W1([Worker 1]) -- "BEGIN · SELECT … FOR UPDATE SKIP LOCKED LIMIT 10" --> T["jobs table<br/>state = pending"]
    W2([Worker 2]) -- "same query, different rows" --> T
    T -- "claimed rows" --> W1
    T -- "claimed rows" --> W2
    W1 -- "do the work · UPDATE state = done · COMMIT" --> T
    W2 -. "crashes → transaction rolls back<br/>rows are claimable again" .-> T

    classDef hot stroke:#e8a33d,stroke-width:2px
    class T hot
```

### Feeding a search index from the WAL

Logical decoding turns the same write-ahead log into a stream of row changes, so
a search index, a cache or a warehouse is fed from the database's own log rather
than by a second write from the application. That is what makes the index
rebuildable, and what keeps it from silently diverging.

```mermaid
flowchart TB
    App([Application]) -- "one write" --> PG["Postgres primary"]
    PG --> WAL["WAL"]
    WAL -- "logical decoding" --> CDC["Debezium"]
    CDC --> Bus{{"Kafka"}}
    Bus --> Indexer["Indexer<br/>idempotent upserts"]
    Indexer --> ES[("Search index")]
    Bus --> Cache[("Cache warmer")]

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class ES,Cache db
    class Bus queue
    class WAL hot
```

### Growing past one primary

Partitioning splits one table by range or hash inside the same database, so
queries and vacuum touch less data. Sharding splits it across independent
clusters keyed by tenant or user id — at which point transactions become sagas
and joins become application-side fan-out, so it is the step you justify.

```mermaid
flowchart TB
    App([Application]) --> Router["Routing<br/>application or Citus"]
    Router -- "tenant 1…n" --> S1["Shard 1<br/>primary + replica"]
    Router -- "tenant n…m" --> S2["Shard 2<br/>primary + replica"]
    S1 --> P1["Partitions by month<br/>drop old ones in one statement"]
    S2 --> P2["Partitions by month"]
    Router -. "cross-shard join<br/>now application work" .-> S2

    classDef hot stroke:#e8a33d,stroke-width:2px
    class Router hot
```
