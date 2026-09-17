---
group: "tech"
order: 6
title: "Elasticsearch"
role: "Search index"
summary: "An inverted index with relevance ranking — a derived view of your data, never the source of truth."
tags: ["elasticsearch", "search", "pagination", "cqrs", "outbox"]
---

# Elasticsearch

## Basics

Elasticsearch wraps Lucene in a distributed cluster. The idea underneath is the
**inverted index**: instead of storing documents and scanning them, it stores, for
every term, the list of documents containing it. Finding every document with
"distributed" becomes a dictionary lookup, and finding documents with two terms
becomes a list intersection.

An index is split into **shards**, each a self-contained Lucene index, with replica
shards for redundancy and read throughput. Shard count is fixed at creation — to
change it you reindex, which is worth knowing because it is the source of a lot of
real-world pain.

Indexing is **near real time**, not real time. New documents become searchable when
a segment is refreshed, by default once a second. Segments are immutable; updates
write a new document and mark the old one deleted, and background merges clean up.

## Key concepts and capabilities

**The analysis chain is where search quality lives.** At index time text is
tokenised, lowercased, stripped of stop words and stemmed ("running" → "run"), and
at query time the same chain runs over the query. Mismatched analyzers are the
usual reason a search returns nothing.

**Typeahead has a specific answer.** Edge n-grams index "sys", "syst", "syste",
"system" at write time so a prefix query is a plain term lookup; the completion
suggester uses a finite state transducer held in memory for the same effect with
less flexibility. Fuzzy matching via edit distance handles typos. Naming one of
these, rather than "Elasticsearch does autocomplete", is what the question is
actually testing.

**Relevance is scored, not boolean.** BM25 rewards rare terms and penalises long
documents. Practical tuning is boosting fields (title over body), recency decay,
and mixing in popularity signals — all of which you can describe without knowing
the formula.

**Aggregations** compute facets, histograms and percentiles over the matching set,
which is why product filters and log dashboards are built on it.

**Pagination has a cliff.** `from: 10000` makes every shard collect and sort 10,000
hits before discarding them. Use `search_after` with a sort cursor for deep
paging, and cap what a user can page through.

**Denormalise.** There are no joins. A "search orders by customer name" feature
means the customer name is copied into the order document, and updated when it
changes.

**Aliases make reindexing survivable.** Applications query an alias; you build a
new index in the background and atomically flip the alias. This is the answer to
"how do you change a mapping?"

## When to use it in an interview

Two shapes come up. The first is **full-text search and typeahead** — a search box
over listings, documents, products, messages. The second is **log and event
search** with aggregations, which is what the ELK stack exists for.

The critical architectural claim, and the one that earns marks, is that
Elasticsearch is a **derived index, not the source of truth**. Writes go to
Postgres or Cassandra; the index is populated from a change stream. Say how: an
outbox table or CDC feeding Kafka, a consumer that upserts documents, and a
reindex job that can rebuild the whole index from scratch. Dual-writing from the
application to both stores is the anti-pattern the interviewer is listening for.

If the corpus is small or the requirement is a simple `LIKE` filter, Postgres
full-text search is a legitimate answer and saves you a system. Say that too —
knowing when *not* to add Elasticsearch reads as judgement.

## What interviewers push on

- **How does the index stay in sync?** Outbox or CDC, an idempotent consumer, and an answer for what happens when the consumer lags: search is briefly stale, and that is acceptable because the source of truth is elsewhere.
- **Deep pagination.** Expect it. `search_after`, not `from`/`size`.
- **Reindexing.** Mappings are close to immutable. Alias plus background rebuild.
- **Typeahead latency.** Edge n-grams, an in-memory index, and a cache of popular prefixes in Redis — a top-10 for a common prefix does not need to hit the cluster at all.
- **Relevance versus recency.** In chat or news search, the newest match usually beats the best-scoring one. Be explicit about the ranking you chose.
- **Cost and memory.** Elasticsearch is hungry: heap for the index, disk for the segments, and a cluster that needs real operations. That is part of the justification for adding it.
