---
group: "tech"
order: 7
title: "OLAP stores"
role: "Analytics store"
summary: "Columnar databases — ClickHouse, Druid, BigQuery — that aggregate billions of rows and cannot do point updates."
tags: ["olap", "stream-processing", "cqrs", "estimation"]
facts:
  - label: "Storage"
    value: "By column, not by row: a query reads only the columns it names"
  - label: "Compression"
    value: "10x is routine — one type per column, mostly sorted"
  - label: "Execution"
    value: "Vectorised: batches of thousands of values, not row at a time"
  - label: "Indexing"
    value: "A sort key with a sparse index, one entry per block"
  - label: "Writes"
    value: "Large appends; a point update rewrites a block"
  - label: "Names"
    value: "ClickHouse, Druid, Pinot; BigQuery, Snowflake, Redshift"
capabilities:
  - title: "Sort key over index"
    body: |-
      Rows are stored in the order of a sorting key with a sparse index — one entry per block of thousands of rows rather than per row.

      A query that filters on the leading columns of the sort key skips most of the table; one that does not, scans. Choosing it is the main modelling decision, and it is usually `(tenant, time)` or `(entity, time)`.
  - title: "Partitions and retention"
    body: |-
      Data is partitioned, almost always by time, so old partitions can be dropped or tiered to object storage in one operation instead of a mass delete.
  - title: "Pre-aggregation"
    body: |-
      Materialized views and rollup tables compute per-minute or per-hour aggregates at ingest, so a dashboard query reads thousands of rows instead of billions. Druid rolls up at ingestion; ClickHouse uses `AggregatingMergeTree` views.

      A pre-aggregated table for the common queries plus the raw table for drill-down is the standard architecture.
  - title: "Approximate is usually enough"
    body: |-
      Distinct counts over billions of rows use HyperLogLog sketches; percentiles use t-digest. Exact `COUNT(DISTINCT)` at that scale is a trap, and "approximate with a 1% error is fine for a dashboard" is the right instinct.
  - title: "Denormalised, star-shaped data"
    body: |-
      Joins are expensive and distributed joins more so. Dimensions are either copied into the fact rows at write time or held in small tables broadcast to every node.
useWhen:
  - "The read side of anything that counts: ad clicks, analytics dashboards, metrics, feature stores, usage billing, A/B results"
  - "Queries are aggregates over huge ranges, and seconds of staleness are fine"
  - "You can keep raw events in object storage and only the aggregates hot"
avoidWhen:
  - "A request needs one row by id — that is Postgres, Cassandra or DynamoDB"
  - "You need transactions, or updates that are not rewrites"
  - "The data is small: a `GROUP BY` in Postgres is one fewer system to run"
probes:
  - question: "Why not just Postgres?"
    answer: "A `GROUP BY` over 50 billion rows reads every row. Columnar storage plus compression plus a rollup table turns a minutes-long scan into a sub-second read — have that rough shape of number ready."
  - question: "How stale is the dashboard?"
    answer: "Streaming ingest gives seconds, batch gives minutes to hours. Decide which the requirement needs before choosing the pipeline."
  - question: "A click arrives ten minutes late."
    answer: "It lands outside its window. Either the stream processor holds windows open with watermarks, or a batch job recomputes and overwrites the partition — the lambda-architecture reconciliation."
  - question: "You grouped by user id over a billion users."
    answer: "Cardinality explosion: memory and rollup size blow up. Bound the dimensions you pre-aggregate on, and keep the high-cardinality drill-down on raw data."
  - question: "A user asks to be deleted."
    answer: "Updates and deletes are rewrites. GDPR erasure and corrections are partition-level rewrites, and it is worth saying so before being asked."
---

# OLAP stores

## How it works

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
large appends and read in large aggregates. They are not a place for point lookups
and they are not transactional.

## The pipeline you will draw

```mermaid
flowchart TB
    Events([Events]) --> K{{"Kafka<br/>raw, retained"}}
    K --> Stream["Stream processor<br/>windows · pre-aggregates"]
    Stream --> Rollup[("Rollup table<br/>per minute · bounded dimensions")]
    K --> Archive[("Object storage<br/>raw events, cheap")]
    Archive --> Batch["Nightly batch<br/>recompute · overwrite partition"]
    Batch --> Rollup
    Rollup --> Dash([Dashboard · sub-second])
    Raw2[("Raw table<br/>drill-down")] --> Dash
    K --> Raw2

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Rollup,Raw2 db
    class K queue
    class Archive blob
    class Stream hot
```

Saying which part is precomputed and which is scanned at query time is the
interesting decision — it is the "now or later" trade in its purest form. The
batch path exists because streams get late and duplicate events wrong, and a
recomputed partition is the cheapest way to make the numbers finally correct.

## Where it fits in a design

An OLAP store is a read side, never an application database. If a request needs
one row by id, that is Postgres, Cassandra or DynamoDB.

> "Raw events in object storage, aggregates hot, and a batch job that corrects
> the stream" is the sentence that shows you have thought about the bill as well
> as the query.
