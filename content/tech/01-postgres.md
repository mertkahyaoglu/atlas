---
group: "tech"
order: 1
title: "PostgreSQL"
role: "Relational store"
summary: "The relational default: transactions, joins and constraints on one primary, until scale forces you off it."
tags: ["postgres", "consistency", "concurrency", "replication", "sharding"]
---

# PostgreSQL

## Basics

Postgres is a single-primary relational database. One node accepts writes; read
replicas stream changes from it. Every write first goes to the **write-ahead log**
(WAL) and is only then applied to data pages, which is what makes a crash
recoverable and what replicas replay to stay current.

Concurrency is handled by **MVCC**: an update writes a new version of the row and
leaves the old one visible to transactions that started earlier. Readers never
block writers and writers never block readers. The cost is garbage — dead row
versions that `VACUUM` reclaims later.

The scaling path, in the order you should say it out loud:

1. **Vertical.** A modern box handles tens of thousands of simple writes per second. Most interview systems never leave this step.
2. **Read replicas.** Reads scale out; writes do not. Replicas lag, usually by milliseconds.
3. **Partitioning.** One table split by range or hash inside the same database, so queries and vacuum touch less data.
4. **Sharding.** Many independent Postgres clusters keyed by tenant or user id, with routing in the application or a proxy such as Citus. Cross-shard transactions and joins stop being free — this is the step you justify carefully.

## Key concepts and capabilities

**ACID and isolation.** The default isolation level is read committed: each
statement sees a fresh snapshot. `repeatable read` pins one snapshot for the whole
transaction, `serializable` additionally detects and aborts transactions that
would have produced a non-serializable result. Knowing the default is read
committed — and that it does *not* prevent lost updates — is the part interviewers
actually probe.

**Locking for correctness.** `SELECT … FOR UPDATE` takes a row lock for the rest of
the transaction, which is how you hold a seat, decrement inventory or move money
without two requests racing. `SELECT … FOR UPDATE SKIP LOCKED` turns a table into
a work queue that several workers can drain safely.

**Constraints as correctness, not decoration.** A `UNIQUE` index on a client-supplied
idempotency key is the cheapest exactly-once mechanism there is: the second
insert fails, and you return the first result. Foreign keys and check constraints
push invariants into the one place every code path goes through.

**Indexes.** B-tree by default; GIN for arrays, JSONB and full-text; GiST for
ranges and PostGIS geometry; BRIN for naturally ordered append-only data. Partial
indexes (`WHERE status = 'pending'`) keep hot indexes small. Covering indexes let
a query be answered without touching the heap.

**More than a row store.** JSONB gives you a document store where the schema is
still in flux. PostGIS does real geospatial indexing and `ST_DWithin` radius
queries. Built-in full-text search is genuinely good up to a few million
documents.

**Replication and CDC.** Streaming replication is asynchronous by default;
`synchronous_commit` can wait for a replica at the cost of write latency. Logical
decoding turns the WAL into a stream of row changes — this is what Debezium
reads, and it is the correct way to feed a search index, a cache or a warehouse
without dual writes.

**Connections are expensive.** Each one is a process with its own memory. Past a
few hundred you need a pooler such as PgBouncer in front, and in a design with
hundreds of application pods you should say so before being asked.

## When to use it in an interview

Reach for Postgres when the data is relational and correctness matters more than
raw volume: users and accounts, orders and payments, bookings and inventory,
anything with a uniqueness or balance invariant. It is the natural **source of
truth** that other stores are derived from — search indexes, caches and analytics
tables downstream of its WAL.

The strongest move is to make it your default and then argue your way off it.
"Postgres holds the orders because I want a transaction across the payment row
and the order row; the feed is Cassandra because it is append-only and needs
multi-region writes" is a much better answer than reaching for a distributed
database on the first slide.

It is the wrong answer when the workload is a firehose of writes with no
relational shape (metrics, clickstream, activity logs), when you need multi-region
writes with no single primary, or when the access pattern is a single key lookup
at a scale where a managed key-value store is simply less work.

## What interviewers push on

- **Where is the write ceiling?** One primary. Name the number you are assuming and what you would do at 10x: partition, then shard by tenant or user id.
- **Replica lag and read-after-write.** A user posts and immediately reloads. Route that read to the primary, pin them to the primary for a few seconds, or return the write's own result.
- **Two requests, one row.** Be ready to write the `FOR UPDATE` or the conditional `UPDATE … WHERE version = $1`, and say which one you chose.
- **Long transactions.** They hold locks and block vacuum, which bloats tables and eventually stalls the database. Keep transactions short and never hold one open across a network call.
- **Hot rows.** A single counter row updated thousands of times per second serialises everything. Shard the counter into N rows, or move it to Redis and reconcile.
- **Cross-shard work after you shard.** Transactions become sagas, joins become application-side fan-out. If you cannot name the shard key, you are not ready to shard.
