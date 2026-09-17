---
group: "tech"
order: 5
title: "DynamoDB"
role: "Managed KV store"
summary: "Key-value and document storage with flat latency at any size, as long as you design for the key."
tags: ["dynamodb", "sharding", "idempotency", "consistency", "caching"]
---

# DynamoDB

## Basics

DynamoDB is a managed key-value and document store. You do not run nodes, choose a
replication factor or plan a resharding: you declare a key and a capacity mode,
and it holds single-digit millisecond latency whether the table has a thousand
items or a trillion.

Every item lives under a **partition key** and, optionally, a **sort key**. The
partition key is hashed to place the item; the sort key orders items inside that
partition and is what makes range queries possible. An item is at most 400 KB.
Data is replicated across three availability zones, so a read is either
**eventually consistent** (the default, cheaper, may be a moment stale) or
**strongly consistent** (reads the leader replica, costs twice as much).

Capacity comes in two modes. **On-demand** bills per request and absorbs spikes
with no configuration. **Provisioned** reserves read and write units and is
cheaper for steady, predictable traffic; auto-scaling adjusts it over minutes, not
seconds.

## Key concepts and capabilities

**You can only query by key.** There is `GetItem` by exact key and `Query` on one
partition key plus a sort-key condition. `Scan` reads the entire table and is the
wrong answer in an interview unless you are doing an offline migration. Everything
else is an index you decided on in advance.

**Indexes.** A **global secondary index** is a separate copy of the table with a
different key, updated asynchronously — so it is eventually consistent and has its
own cost. A **local secondary index** keeps the partition key and changes the sort
key, is strongly consistent, and must exist when the table is created.

**Single-table design.** Because there are no joins, related entities are often
packed into one table with a composite key scheme (`PK=USER#123`,
`SK=ORDER#2026-01-02`) so one `Query` returns a user and their recent orders in a
single round trip. It reads strangely and it is the idiomatic pattern; know that
it exists and why.

**Conditional writes are the concurrency primitive.** `PutItem` with
`attribute_not_exists(pk)` is an atomic insert-if-absent — an idempotency key, a
username claim, a distributed lock. `UpdateItem` with `ConditionExpression`
implements optimistic concurrency (`version = :expected`) and atomic counters
(`ADD count :n`). `TransactWriteItems` gives all-or-nothing across up to 100 items,
at twice the cost.

**Streams.** Every change can be published to a **DynamoDB Stream**, ordered per
partition key and retained 24 hours. That is the hook for change data capture:
fan out to a search index, maintain an aggregate, trigger a Lambda. It is how you
avoid dual writes.

**TTL** deletes expired items in the background for free — sessions, carts, rate
limit buckets. **DAX** is an in-front write-through cache when microseconds
matter. **Global tables** replicate multi-region with last-writer-wins conflict
resolution.

## When to use it in an interview

Choose DynamoDB when access is by a key you know at design time, the scale is
large or spiky, and you would rather not talk about operations at all: user
profiles, sessions, shopping carts, device state, URL-shortener mappings, object
metadata beside an S3 blob, per-user rate limit counters.

It is strongest when the interviewer has framed the problem on AWS, or when you
want the properties of Cassandra without the operational story. The comparison is
worth having ready: same wide-column shape and hot-partition risk, but managed,
with conditional writes and transactions built in, and a hard item size limit.

Avoid it when queries are ad hoc or analytical, when you need joins or
multi-entity transactions as the norm rather than the exception, or when the
data set is small enough that Postgres is simply less thinking.

## What interviewers push on

- **Hot partitions.** Traffic concentrated on one partition key gets throttled even though the table has capacity. Add a suffix to spread a hot key, or bucket by time. Adaptive capacity helps, but it is not a design.
- **Choosing the key.** Expect to be asked what the partition key and sort key are, and which queries each index serves. Not having an index for a query you described is the classic miss.
- **GSI lag.** A read from a GSI right after a write may not see it. If a flow depends on that, it needs the base table or a different design.
- **Strong vs eventual reads.** Say which one each read path uses and why. Defaulting everything to strong doubles cost for no reason.
- **Exactly-once.** The expected answer is a conditional write on an idempotency key, not a lock.
- **Cost.** Someone will ask what a million writes a day costs, or why a `Scan` is expensive. Reason in request units: a write unit is 1 KB, a read unit is 4 KB eventually consistent.
