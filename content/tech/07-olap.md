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
concepts:
  - "**Columnar storage** — a query touching 3 of 50 columns reads 6% of the bytes, and compresses ~10x on the way"
  - "**Sort key, not index** — a sparse index per block; filter on its leading columns or you scan the table"
  - "**Partition by time** — so retention is dropping a partition, not a mass delete"
  - "**Pre-aggregation** — rollup tables and materialized views turn a billion-row scan into a few thousand rows"
  - "**Approximate counting** — HyperLogLog for distincts, t-digest for percentiles; exact `COUNT(DISTINCT)` is a trap"
  - "**Denormalised, star-shaped** — dimensions copied into fact rows or broadcast as small tables, because joins are dear"
  - "**Updates are rewrites** — corrections and GDPR erasure are partition-level operations"
  - "**Ingest is streaming or batch** — Kafka to a stream processor for seconds, a nightly job to correct what the stream got wrong"
  - "**Not an application database** — one row by id belongs in Postgres, Cassandra or DynamoDB"
---

# OLAP stores

## Use cases

### Counting clicks per minute, at a billion a day

The standard pipeline: events land in Kafka, a stream processor windows and
pre-aggregates them, and the rollup table is what the dashboard queries. The
batch path exists because streams get late and duplicate events wrong, and
recomputing a partition is the cheapest way to make the numbers finally correct.

```mermaid
flowchart TB
    Events([Ad events]) --> K{{"Kafka<br/>raw, retained"}}
    K --> Stream["Stream processor<br/>1-minute windows"]
    Stream --> Rollup[("Rollup table<br/>per minute · bounded dimensions")]
    K --> Archive[("Object storage<br/>raw events, cheap")]
    Archive --> Batch["Nightly batch<br/>recompute · overwrite partition"]
    Batch --> Rollup
    Rollup --> Dash([Dashboard · sub-second])

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Rollup db
    class K queue
    class Archive blob
    class Stream hot
```

### A rollup for the dashboard, raw rows for the drill-down

Two tables, and knowing which query hits which is the design. The rollup is
bounded — a handful of dimensions, one row per minute per combination — and the
raw table keeps the high-cardinality columns for the rare query that needs a
single user or request.

```erd
# Pre-aggregated · what the dashboard reads
clicks_per_minute || sorted by (ad_id, minute); a day of one campaign is a few thousand rows || ClickHouse
+ ad_id || bigint || PK
+ minute_bucket || timestamp || PK
+ country || text || PK
+ device || text || PK
+ impressions || bigint
+ clicks || bigint
+ unique_users || HLL sketch
+ spend || decimal
# Raw · what the drill-down reads
click_events || partitioned by day; dropped, not deleted, at the end of retention || ClickHouse
+ ad_id || bigint || PK
+ ts || timestamp || SK
+ user_id || uuid
+ country || text
+ device || text
```

### Keeping the bill sane as data ages

Retention is a partition operation, not a `DELETE`. Recent partitions stay on
fast disk, older ones are tiered to object storage, and the oldest are dropped
whole — which is also the answer to "what does keeping a year of this cost?"

```mermaid
flowchart TB
    Ingest([Ingest]) --> Hot[("Last 7 days<br/>local SSD · queried constantly")]
    Hot -- "age out" --> Warm[("8–90 days<br/>object storage tier")]
    Warm -- "age out" --> Drop["DROP PARTITION<br/>one operation, no scan"]
    Raw[("Raw events in object storage<br/>Parquet, kept longer, cheap")] -. "replay if a number is wrong" .-> Hot

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Hot,Warm db
    class Raw blob
    class Drop hot
```
