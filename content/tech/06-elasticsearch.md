---
group: "tech"
order: 6
title: "Elasticsearch"
role: "Search index"
summary: "An inverted index with relevance ranking — a derived view of your data, never the source of truth."
tags: ["elasticsearch", "search", "pagination", "cqrs", "outbox"]
facts:
  - label: "Model"
    value: "Inverted index: term → the documents containing it"
  - label: "Unit of scale"
    value: "Shards, each a Lucene index, plus replica shards"
  - label: "Shard count"
    value: "Fixed at creation; changing it means a reindex"
  - label: "Freshness"
    value: "Near real time — searchable after a refresh, ~1s"
  - label: "Storage"
    value: "Immutable segments; updates write a new doc and merge later"
  - label: "Role"
    value: "Derived index. The source of truth lives somewhere else"
concepts:
  - "**Inverted index** — every term maps to the documents holding it, so a match is a lookup and an intersection"
  - "**The analysis chain** — tokenise, lowercase, remove stop words, stem, at index *and* query time; mismatches return nothing"
  - "**BM25 relevance** — rare terms score higher, long documents lower; tune by boosting fields and decaying by recency"
  - "**Aggregations** — facets, histograms and percentiles over the matching set, which is what log dashboards are"
  - "**Edge n-grams** index every prefix at write time, which is how typeahead is a plain term lookup"
  - "**Deep paging has a cliff** — `from: 10000` sorts 10,000 hits per shard; use `search_after` with a cursor"
  - "**No joins** — denormalise, and copy the customer name into the order document when it changes"
  - "**Aliases** — applications query an alias so a rebuilt index can be swapped in atomically"
  - "**It is derived** — fed from a change stream, rebuildable from scratch, and never the place a write lands first"
---

# Elasticsearch

## Use cases

### A search index kept in sync by a change stream

The architectural claim that earns marks: writes go to the database, and the
index is fed from its change stream by an idempotent consumer. Dual-writing from
the application is the anti-pattern being listened for, and a reindex job is what
makes a bad mapping or a dropped message recoverable.

```mermaid
flowchart TB
    Write([Write]) --> PG[("Postgres<br/>source of truth")]
    PG -- "outbox / CDC" --> Bus{{"Kafka"}}
    Bus --> Indexer["Indexer<br/>idempotent upserts"]
    Indexer --> ES["Elasticsearch<br/>alias → index_v3"]
    Reindex["Reindex job<br/>rebuilds from Postgres"] -.-> ES
    Query([Search]) --> ES

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class PG db
    class Bus queue
    class ES hot
```

### Typeahead in fifty milliseconds

Edge n-grams index "sys", "syst", "syste" at write time, so a prefix query is a
plain term lookup rather than a wildcard scan. Put a cache of popular prefixes in
front and the common case never reaches the cluster at all.

```mermaid
flowchart TB
    Key([Keystroke "sys"]) --> Cache{{"Redis<br/>top-10 per popular prefix"}}
    Cache -- "hit · ~1 ms" --> Key
    Cache -. "miss" .-> ES["Elasticsearch<br/>edge n-gram field"]
    ES -- "term lookup, not a wildcard" --> Key
    Index([Document indexed]) -- "sys · syst · syste · system" --> ES
    ES -. "fuzzy: edit distance 1<br/>catches typos" .-> ES

    classDef cache fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Cache cache
    class ES hot
```

### Faceted search over shards

A query fans out to every shard, each returns its top hits and its slice of the
aggregations, and the coordinating node merges them. That is why facets are cheap
and page 500 is not: every shard has to sort everything before the offset.

```mermaid
flowchart TB
    Q([Query + filters]) --> Coord["Coordinating node"]
    Coord --> S1["Shard 1<br/>top hits + agg slice"]
    Coord --> S2["Shard 2"]
    Coord --> S3["Shard 3"]
    S1 --> Merge["Merge · rank · facet counts"]
    S2 --> Merge
    S3 --> Merge
    Merge --> Q
    Merge -. "deep paging: use search_after<br/>not from/size" .-> Q

    classDef hot stroke:#e8a33d,stroke-width:2px
    class Merge hot
```

### Changing a mapping without downtime

Mappings are close to immutable, so you do not change one: you build a new index
beside the old one, backfill it from the source of truth, and flip the alias in a
single atomic step. The application never learns the index name.

```mermaid
flowchart TB
    App([Application]) -- "queries the alias" --> Alias{"alias: products"}
    Alias --> V2["products_v2<br/>serving"]
    Backfill["Reindex from Postgres<br/>into products_v3"] --> V3["products_v3<br/>new mapping"]
    V3 -. "atomic alias flip" .-> Alias
    V2 -. "delete once traffic moved" .-> V2

    classDef hot stroke:#e8a33d,stroke-width:2px
    class Alias hot
```
