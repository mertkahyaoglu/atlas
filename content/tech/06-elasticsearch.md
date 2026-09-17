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
capabilities:
  - title: "The analysis chain is where search quality lives"
    body: |-
      At index time text is tokenised, lowercased, stripped of stop words and stemmed ("running" → "run"), and at query time the same chain runs over the query.

      Mismatched analyzers are the usual reason a search returns nothing.
  - title: "Typeahead has a specific answer"
    body: |-
      Edge n-grams index "sys", "syst", "syste", "system" at write time so a prefix query is a plain term lookup. The completion suggester uses a finite state transducer held in memory for the same effect with less flexibility. Fuzzy matching by edit distance handles typos.

      Naming one of these, rather than "Elasticsearch does autocomplete", is what the question is testing.
  - title: "Relevance is scored, not boolean"
    body: |-
      BM25 rewards rare terms and penalises long documents. Practical tuning is boosting fields (title over body), recency decay, and mixing in popularity signals — all of which you can describe without knowing the formula.
  - title: "Aggregations"
    body: |-
      Facets, histograms and percentiles over the matching set, which is why product filters and log dashboards are built on it.
  - title: "Pagination has a cliff"
    body: |-
      `from: 10000` makes every shard collect and sort 10,000 hits before discarding them. Use `search_after` with a sort cursor for deep paging, and cap what a user can page through at all.
  - title: "Denormalise, and use aliases"
    body: |-
      There are no joins: "search orders by customer name" means the customer name is copied into the order document and updated when it changes.

      Applications query an **alias**; you build a new index in the background and flip the alias atomically. That is the answer to "how do you change a mapping?"
useWhen:
  - "Full-text search and typeahead: a search box over listings, documents, products, messages"
  - "Log and event search with aggregations — what the ELK stack exists for"
  - "You can feed it from a change stream and rebuild it from scratch when it drifts"
avoidWhen:
  - "The corpus is small or the requirement is a simple `LIKE` filter — Postgres full-text search saves you a system"
  - "The data has to be authoritative: this is a derived index, always"
  - "You cannot afford the operations: heap for the index, disk for segments, a cluster to run"
probes:
  - question: "How does the index stay in sync with the database?"
    answer: "Outbox or CDC into a queue, an idempotent consumer that upserts. When the consumer lags, search is briefly stale — acceptable, because the source of truth is elsewhere. Dual-writing from the application is the anti-pattern being listened for."
  - question: "The user asks for page 500."
    answer: "`from`/`size` makes every shard sort half a million hits. Use `search_after` with a sort cursor, and cap how deep a user can page."
  - question: "How do you change a mapping on a live index?"
    answer: "You don't. Build a new index in the background and flip an alias atomically."
  - question: "Typeahead has to answer in 50 ms."
    answer: "Edge n-grams or the completion suggester, plus a Redis cache of popular prefixes — a top-10 for a common prefix never needs to reach the cluster."
  - question: "Newest match or best match?"
    answer: "In chat or news search the newest usually wins; in product search relevance does. Be explicit about the ranking you chose and why."
  - question: "What does adding Elasticsearch cost you?"
    answer: "A second copy of the data, a pipeline that can lag, and a cluster with real operational needs. That is why you justify it rather than reach for it."
---

# Elasticsearch

## How it works

Elasticsearch wraps Lucene in a distributed cluster. The idea underneath is the
**inverted index**: instead of storing documents and scanning them, it stores, for
every term, the list of documents containing it. Finding every document with
"distributed" becomes a dictionary lookup, and finding documents with two terms
becomes a list intersection.

An index is split into **shards**, each a self-contained Lucene index, with replica
shards for redundancy and read throughput. Indexing is **near real time**, not real
time: new documents become searchable when a segment is refreshed, by default once
a second. Segments are immutable; updates write a new document and mark the old one
deleted, and background merges clean up.

## The architecture that earns marks

Elasticsearch is a **derived index, not the source of truth**. Writes go to
Postgres or Cassandra; the index is populated from a change stream, and can be
rebuilt from scratch whenever it drifts.

```mermaid
flowchart TB
    Write([Write]) --> PG[("Postgres<br/>source of truth")]
    PG -- "outbox / CDC" --> Bus{{"Kafka"}}
    Bus --> Indexer["Indexer<br/>idempotent upserts"]
    Indexer --> ES["Elasticsearch<br/>alias → index_v3"]
    Reindex["Reindex job<br/>rebuilds from Postgres"] -.-> ES
    Query([Search query]) --> ES
    ES -- "ranked hits + facets" --> Query

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class PG db
    class Bus queue
    class ES hot
```

The dashed line matters as much as the solid ones: if you cannot rebuild the
index from the source of truth, a bad mapping or a dropped message is permanent.
Dual-writing from the application to both stores is the anti-pattern the
interviewer is listening for.

## Where it fits in a design

Two shapes come up: full-text search and typeahead over a corpus, and log or
event search with aggregations. Both are read-side systems hanging off a write
store.

> If the corpus is small or the requirement is a simple `LIKE` filter, Postgres
> full-text search is a legitimate answer and saves you a system. Knowing when
> *not* to add Elasticsearch reads as judgement.
