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
capabilities:
  - title: "ACID and isolation"
    body: |-
      The default isolation level is read committed: each statement sees a fresh snapshot. `repeatable read` pins one snapshot for the whole transaction, `serializable` additionally detects and aborts transactions that would have produced a non-serializable result.

      Knowing the default is read committed — and that it does *not* prevent lost updates — is the part interviewers actually probe.
  - title: "Locking for correctness"
    body: |-
      `SELECT … FOR UPDATE` takes a row lock for the rest of the transaction, which is how you hold a seat, decrement inventory or move money without two requests racing.

      `SELECT … FOR UPDATE SKIP LOCKED` turns a table into a work queue that several workers can drain safely.
  - title: "Constraints as correctness, not decoration"
    body: |-
      A `UNIQUE` index on a client-supplied idempotency key is the cheapest exactly-once mechanism there is: the second insert fails, and you return the first result. Foreign keys and check constraints push invariants into the one place every code path goes through.
  - title: "Indexes"
    body: |-
      B-tree by default; GIN for arrays, JSONB and full-text; GiST for ranges and PostGIS geometry; BRIN for naturally ordered append-only data.

      Partial indexes (`WHERE status = 'pending'`) keep hot indexes small. Covering indexes let a query be answered without touching the heap.
  - title: "More than a row store"
    body: |-
      JSONB gives you a document store where the schema is still in flux. PostGIS does real geospatial indexing and `ST_DWithin` radius queries. Built-in full-text search is genuinely good up to a few million documents.

      Each one is a store you did *not* have to add to the diagram.
  - title: "Replication and CDC"
    body: |-
      Streaming replication is asynchronous by default; `synchronous_commit` can wait for a replica at the cost of write latency.

      Logical decoding turns the WAL into a stream of row changes — this is what Debezium reads, and it is the correct way to feed a search index, a cache or a warehouse without dual writes.
  - title: "Connections are expensive"
    body: |-
      Each one is a process with its own memory. Past a few hundred you need a pooler such as PgBouncer in front, and in a design with hundreds of application pods you should say so before being asked.
useWhen:
  - "The data is relational and correctness matters more than raw volume: users and accounts, orders and payments, bookings and inventory"
  - "An invariant has to hold — a uniqueness key, a balance, a seat that only one person gets"
  - "You want one **source of truth** that search indexes, caches and warehouses are derived from, through its WAL"
  - "The write rate fits one primary, which at interview scale it usually does"
avoidWhen:
  - "The workload is a firehose of writes with no relational shape: metrics, clickstream, activity logs"
  - "You need multi-region writes with no single primary"
  - "The access pattern is a single key lookup at a scale where a managed key-value store is simply less work"
  - "The query pattern is analytical scans over billions of rows — that is an OLAP store's job"
probes:
  - question: "Where is the write ceiling?"
    answer: "One primary. Name the number you are assuming and what you would do at 10x: partition first, then shard by tenant or user id."
  - question: "A user posts and immediately reloads. What do they see?"
    answer: "Replica lag, unless you handle it. Route that read to the primary, pin the user to the primary for a few seconds, or return the write's own result instead of re-reading."
  - question: "Two requests, one row. Write the query."
    answer: "Either `SELECT … FOR UPDATE` inside the transaction, or a conditional `UPDATE … WHERE version = $1` and retry on zero rows. Say which one you chose and why."
  - question: "What breaks when a transaction stays open for minutes?"
    answer: "It holds locks and blocks vacuum, so dead rows accumulate, tables bloat and the database eventually stalls. Keep transactions short, and never hold one open across a network call."
  - question: "One counter row is updated thousands of times a second. Now what?"
    answer: "Every writer serialises on that row. Shard the counter into N rows and sum them, or move it to Redis and reconcile periodically."
  - question: "You sharded. What did it cost you?"
    answer: "Transactions become sagas and joins become application-side fan-out. If you cannot name the shard key, you are not ready to shard."
---

# PostgreSQL

## How it works

Postgres is a single-primary relational database. One node accepts writes; read
replicas stream changes from it. Every write first goes to the **write-ahead log**
(WAL) and is only then applied to data pages, which is what makes a crash
recoverable and what replicas replay to stay current.

Concurrency is handled by **MVCC**: an update writes a new version of the row and
leaves the old one visible to transactions that started earlier. Readers never
block writers and writers never block readers. The cost is garbage — dead row
versions that `VACUUM` reclaims later.

```mermaid
flowchart TB
    App([Application]) -- "BEGIN … COMMIT" --> PG["Postgres primary<br/>the only writer"]
    PG --> WAL["1 · append to the WAL<br/>fsync, then ack"]
    WAL -- "ack: durable" --> App
    WAL --> Pages["2 · dirty pages<br/>checkpointer flushes later"]
    WAL -- "streaming<br/>replication" --> Replica[("Read replica<br/>ms behind")]
    WAL -- "logical<br/>decoding" --> CDC{{"CDC stream<br/>index · cache · warehouse"}}

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Replica db
    class CDC queue
    class WAL hot
```

The WAL is why one durable write is cheap: an append and an `fsync`, not a
random page write. It is also the seam every derived store hangs off, so a
search index or a cache is fed by the same log rather than by a second write
from the application.

## The scaling path

Say it in this order, and stop at the step the numbers justify:

1. **Vertical.** A modern box handles tens of thousands of simple writes per second. Most interview systems never leave this step.
2. **Read replicas.** Reads scale out; writes do not. Replicas lag, usually by milliseconds.
3. **Partitioning.** One table split by range or hash inside the same database, so queries and vacuum touch less data.
4. **Sharding.** Many independent Postgres clusters keyed by tenant or user id, with routing in the application or a proxy such as Citus. Cross-shard transactions and joins stop being free — this is the step you justify carefully.

## Where it fits in a design

Postgres is the natural **source of truth**: the row that must be right lives
here, and everything else is derived from it. A worked example — orders paid for
exactly once, with the idempotency key and the money in the same transaction:

```erd
# Orders · Postgres
orders || one row per order; state moves forward only
+ order_id || bigint || PK
+ customer_id || bigint || → customers
+ state || pending | paid | refunded
+ total_minor_units || bigint
+ created_at || timestamptz
# Customers and payments
customers
+ customer_id || bigint || PK
+ email || citext
+ created_at || timestamptz
+ UNIQUE (email)
payment_attempts || the UNIQUE key is the whole idempotency mechanism
+ attempt_id || bigint || PK
+ order_id || bigint || → orders
+ idempotency_key || uuid
+ psp_ref || text || null
+ state || text
+ UNIQUE (order_id, idempotency_key)
```

> The strongest move is to make Postgres your default and then argue your way
> off it. *"Postgres holds the orders because I want a transaction across the
> payment row and the order row; the feed is Cassandra because it is append-only
> and needs multi-region writes"* is a much better answer than reaching for a
> distributed database on the first slide.
