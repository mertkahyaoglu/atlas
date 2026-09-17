---
group: "tech"
order: 7
title: "OLAP stores"
role: "Analytics store"
summary: "Columnar databases — ClickHouse, Druid, BigQuery — that aggregate billions of rows and cannot do point updates."
tags: ["olap", "stream-processing", "cqrs", "estimation"]
---

# OLAP stores

## Basics

An OLAP store answers questions like "clicks per campaign per minute for the last
30 days" over tables with hundreds of billions of rows. It does that by storing
data **by column instead of by row**.

That one change cascades. A query touching 3 of 50 columns reads 6% of the bytes.
A column holds values of one type, often nearly sorted and highly repetitive, so
compression ratios of 10x are routine — and compressed data means less disk and
less memory bandwidth, which is the actual bottleneck. Execution is vectorised:
the engine processes batches of thousands of values in tight loops rather than a
row at a time.

The trade is symmetrical. Fetching one whole row means touching every column file,
and updating a single value means rewriting a block. OLAP stores are written in
large appends and read in large aggregates. They are not a place for point
lookups and they are not transactional.

The names worth knowing: **ClickHouse** (self-hosted, extremely fast, ingests from
Kafka directly), **Druid** (real-time ingestion split from historical segments,
built for time-series dashboards), **BigQuery / Snowflake / Redshift** (managed
warehouses, storage separated from compute), and **Pinot** (low-latency, user-facing
analytics).

## Key concepts and capabilities

**Sort key over index.** Rows are stored in the order of a sorting key with a
sparse index — one entry per block of thousands of rows rather than per row. A
query that filters on the leading columns of the sort key skips most of the table;
one that does not, scans. Choosing the sort key is the main modelling decision,
and it is usually `(tenant, time)` or `(entity, time)`.

**Partitions and retention.** Data is partitioned, almost always by time, so old
partitions can be dropped or tiered to object storage in one operation instead of
a mass delete.

**Pre-aggregation.** Materialized views and rollup tables compute per-minute or
per-hour aggregates at ingest, so a dashboard query reads thousands of rows
instead of billions. Druid rolls up at ingestion time; ClickHouse uses
`AggregatingMergeTree` materialized views. Combining a pre-aggregated table for
common queries with the raw table for drill-down is the standard architecture.

**Approximate is usually enough.** Distinct counts over billions of rows use
HyperLogLog sketches; percentiles use t-digest. Exact `COUNT(DISTINCT)` at that
scale is a trap, and saying "approximate with a 1% error is fine for a dashboard"
is the right instinct.

**Denormalised, star-shaped data.** Joins are expensive and distributed joins more
so. Dimensions are either copied into the fact rows at write time or held in small
tables broadcast to every node.

**Ingestion is streaming or batch.** The normal pipeline is Kafka → a stream
processor → the OLAP store, with a nightly batch job that recomputes the same
numbers from the raw events in object storage and corrects anything the stream got
wrong.

## When to use it in an interview

An OLAP store is the read side of any design that counts things: ad click
aggregation, analytics dashboards, metrics and monitoring, recommendation feature
stores, usage-based billing, A/B test results.

The shape to draw is almost always the same — events land in Kafka, a stream
processor windows and pre-aggregates them, the results land in the OLAP store, and
the dashboard queries it. Saying which part is precomputed and which is scanned at
query time is the interesting decision, because it is the "now or later" trade in
its purest form.

Do not use it as an application database. If a request needs one row by id, that
is Postgres, Cassandra or DynamoDB. A design that sends user-facing point reads to
ClickHouse will get pushed on.

## What interviewers push on

- **Why not just Postgres?** Because a `GROUP BY` over 50 billion rows reads every row. Have a rough number ready: columnar plus compression plus pre-aggregation turns a minutes-long scan into a sub-second read of a rollup table.
- **Freshness.** How stale is the dashboard? Streaming ingest gives seconds; batch gives minutes to hours. Say which one the requirement needs before choosing.
- **Late and duplicate events.** A click arriving ten minutes late lands outside its window. Either the stream processor holds the window open with watermarks, or a batch job recomputes and overwrites the partition — the lambda-architecture reconciliation.
- **Cardinality.** Grouping by user id over a billion users blows up memory and rollup size. Bound the dimensions you pre-aggregate on.
- **Updates and deletes.** Effectively rewrites. GDPR deletion and corrections need partition-level rewrites, and it is worth saying so.
- **Cost of raw retention.** Keep raw events in object storage and only the aggregates hot. That is the sentence that shows you have thought about the bill.
