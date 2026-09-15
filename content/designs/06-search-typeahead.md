---
group: "design"
order: 6
title: "Search and Typeahead"
summary: "A billion documents, a hundred thousand queries a second, and autocomplete firing on every keystroke."
hardPart: "Search is a scatter-gather, so your latency is your slowest shard. And the index is not the source of truth — you have to explain how it stays in sync and that it lags."
tags: ["search", "elasticsearch", "sharding", "caching"]
hardPartDetail: "Two things. (1) Search is a scatter-gather — your latency is bounded by your slowest shard, so tail latency dominates. (2) The search index is *not* your source of truth; you must explain how it stays in sync and that it lags."
concepts:
  - "inverted index"
  - "tokenization and stemming"
  - "TF-IDF/BM25 ranking"
  - "scatter-gather sharding"
  - "tail latency"
  - "near-real-time indexing"
  - "tries"
  - "CDC pipelines"
  - "caching"
requirements:
  functional:
    - "Full-text search over documents (products, posts, repos)"
    - "Typeahead suggestions as the user types"
    - "Filters/facets (category, date range, price)"
    - "Relevance ranking, pagination"
    - "Typo tolerance"
  nonFunctional:
    - "Typeahead p99 < 100ms (it fires on every keystroke)"
    - "Search p99 < 300ms"
    - "Index freshness: new documents searchable within ~seconds"
    - "Read-heavy, high query volume"
  outOfScope: "personalization/learned ranking models, image search."
scale:
  numbers: |-
    Documents:    1B
    Queries:      100,000/sec search
    Typeahead:    500,000/sec (fires per keystroke — 5x search volume!)
    Index size:   1B docs × ~1KB indexed → ~1 TB → ~20 shards of 50 GB
    Query cache hit rate: 60-80% (head queries are extremely repetitive)
  conclusion: "Typeahead is a *higher-volume, lower-latency* problem than search itself. It needs a completely different data structure (in-memory trie), not the search cluster. Recognizing that is half the answer."
tradeoffs:
  - title: "Why an inverted index at all"
    body: |-
      `WHERE body LIKE '%distributed%'` cannot use a B-tree index (leading wildcard) and scans every row. The inverted index flips the mapping so lookup is O(1) on the term plus a posting-list intersection. For a multi-word query, intersect the posting lists, starting with the *shortest* one to minimize work.
  - title: "Index-time and query-time analysis must be identical"
    body: |-
      If you stem at index time but not at query time, a search for "running" won't match the indexed token "run". This is the single most common real-world search bug and a good thing to mention.
  - title: "Ranking: TF-IDF → BM25"
    body: |-
      TF-IDF says a term matters if it's frequent in this document but rare in the corpus. BM25 adds saturation (the 50th occurrence of a word adds less than the 2nd) and document-length normalization (so long documents don't win by accident). Then layer business signals — recency, popularity, quality — as a weighted combination or a learned model.
  - title: "Sharding by document, not by term"
    body: |-
      - *Document-partitioned* (standard): each shard holds a complete index for its subset of documents. Every query hits every shard (scatter-gather), but each shard's work is small and the system is easy to grow.
      - *Term-partitioned*: each shard holds all postings for a subset of terms. A single-term query hits one shard, but multi-term queries require shipping huge posting lists across the network, and popular terms create brutal hotspots. Almost always the wrong choice — worth knowing so you can reject it with a reason.
  - title: "Tail latency is the defining constraint"
    body: |-
      With 20 shards, your p99 is roughly the p99 of the *maximum* of 20 samples, which is far worse than any single shard's p99 (Module 1's tail amplification). Mitigations to name:
      - **Hedged requests**: after waiting the p95 latency, send a duplicate request to another replica and take whichever answers first.
      - **Timeout with partial results**: return what you have from 19 shards rather than waiting for the 20th. Search users tolerate slightly worse results far better than a spinner.
      - **Replica load balancing** away from slow nodes.
  - title: "Near-real-time, not real-time"
    body: |-
      Engines buffer writes in memory and periodically flush to a new immutable segment (Elasticsearch refreshes ~once per second by default). Segments are later merged in the background. So there is a ~1s window where a written document isn't searchable. Say this out loud; claiming instant searchability is a credibility hit. If a user must see their own new item immediately, special-case it from the source of truth rather than tightening the refresh interval globally.
  - title: "Typeahead is a different system"
    body: |-
      Requirements differ on every axis: 5x the query volume, 10x tighter latency, and only prefixes matter. So:
      - Use an in-memory **trie** with the top-K completions precomputed and stored at each node, so a lookup is a walk down the prefix with no ranking work at query time.
      - Rebuild it offline from query logs (hourly or daily) — suggestions don't need to be fresh to the second.
      - **Debounce on the client** (~50ms) and cancel in-flight requests when the user keeps typing. This alone cuts backend load by more than half.
      - Cache aggressively at the edge; prefix distribution is extremely head-heavy.
  - title: "Typo tolerance"
    body: |-
      Edit-distance matching is expensive over 1B docs. Practical approaches: precomputed common misspelling → correction mappings from query logs, n-gram indexes for fuzzy matching, and "did you mean" suggestions rather than silently expanding the query.
  - title: "Query cache"
    body: |-
      Normalize the query (lowercase, sort filters, strip whitespace) before using it as a cache key, or you'll cache the same query a dozen ways. Head queries repeat enormously, so hit rates of 60-80% are realistic and this is the cheapest latency win available.
  - title: "The index is derived, always"
    body: |-
      Feed it from CDC or an event stream, never make it the write path's dependency, and be able to rebuild it from scratch by replaying. If the index is corrupted or the mapping changes, you reindex — which is only possible because the source of truth is elsewhere.
followUps:
  - question: "How do you reindex 1B documents with no downtime?"
    answer: "Build a new index alongside the old, replay from the source of truth, then atomically swap an alias from old to new. Keep the old around briefly for rollback."
  - question: "How do faceted counts work?"
    answer: "Aggregate per shard during the scan and merge the counts. Exact counts on high-cardinality facets are expensive; approximate counts (or top-N only) are the usual compromise."
  - question: "How do you handle permissions/private documents?"
    answer: "Filter at query time by an access-control field in the index, or run a separate per-tenant index. Post-filtering after ranking breaks pagination, so filter during the scan."
  - question: "Deep pagination (page 500)?"
    answer: "Scatter-gather with a large offset means every shard returns 10,000 results to be merged. Use cursor/`search_after` semantics instead, or cap depth — most search products cap at ~1,000 results and that's an acceptable product decision."
  - question: "How would you add personalization?"
    answer: "A second ranking stage: retrieve top ~500 with BM25, then rescore with a model using user features. Two-stage retrieval keeps the expensive model off the full corpus."
  - question: "What breaks first at 10x?"
    answer: "Typeahead QPS and the scatter-gather fan-out. Fix typeahead with edge caching and more suggest replicas (it's cheap to replicate, being read-only); fix search by adding shards, accepting that more shards worsens tail latency and needs hedging."
---
# 06 — Search / Autocomplete (Typeahead)

## API / Model

```api
GET /v1/search?q=&filters=&sort=&cursor=&limit=20 || || 200 ranked results
GET /v1/suggest?q=&limit=10 || || 200 completions || separate service, separate SLA
```

```schema
# Inverted index · per shard
term → posting list || || "distributed" → [(doc1, tf=3, pos[...]), (doc7, tf=1), (doc22, tf=5)] ||
# Doc store · hydration and display fields
doc_id || || {title, snippet, url, metadata} ||
# Trie · typeahead, in memory
trie node || || top-K completions by popularity || cached on every node
# Source of truth
Postgres / Cassandra || || || the index is derived, never authoritative
```

---

## High-level architecture

<!-- tab: Today · 1B docs -->

```mermaid
flowchart TB
    subgraph ING ["Indexing path · seconds behind the source"]
        direction TB
        Truth[("Source of truth<br/>Postgres / Cassandra")]
        CDC{{"Kafka · document.changed<br/>via CDC / Debezium"}}
        Pipe["Analysis pipeline<br/>tokenize → lowercase → stopwords<br/>→ stem → enrich"]
        Truth --> CDC --> Pipe
    end

    subgraph QUERY ["Query path"]
        direction TB
        User([User typing])
        Suggest["Suggest Service<br/>in-memory trie · ~5ms<br/>no disk, no ranking at query time"]
        Trie[("Trie · top-K per prefix<br/>rebuilt offline from query logs")]
        Search[Search Service]
        QCache[("Query cache · Redis<br/>normalized key · 60-80% hit")]
        Parser["Query parser<br/>SAME analysis chain as indexing<br/>+ spell correction"]
        User -- "every keystroke<br/>debounced 50ms" --> Suggest
        Suggest --- Trie
        User -- "on submit" --> Search
        Search --> QCache
        QCache -- "miss" --> Parser
    end

    subgraph SHARDS ["Inverted index · document-partitioned, 3x replicated"]
        direction LR
        S0[("Shard 0")]
        S1[("Shard 1")]
        S2[("Shard N")]
    end
    Pipe -- "route by hash(doc_id)" --> S0
    Pipe --> S1 & S2
    Parser -- "scatter to every shard" --> S0
    Parser --> S1 & S2

    S0 -- "top 20 · BM25 from each" --> Gather
    S1 & S2 --> Gather
    Gather["Merge and re-rank → global top 20<br/>latency bounded by SLOWEST shard<br/>hedged requests · timeout → partial results"]
    Gather --> Hydrate["Hydrate titles, snippets, facets<br/>cache the result"]
    Hydrate --> Results([Results to user])

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Truth,S0,S1,S2,Trie db
    class QCache cache
    class Gather hot
    class CDC queue

    click Truth href "/docs/02-data-storage" "Role: the authoritative data that the search index is derived from.<br/>Trade-off: the index can always be rebuilt, but is never guaranteed current."
    click CDC href "/docs/05-async-messaging-and-event-driven" "Role: streams database changes to indexing without dual writes.<br/>Trade-off: seconds of indexing lag, so results can miss the latest edits."
    click QCache href "/docs/04-caching" "Role: serves the repeated queries that dominate traffic straight from memory.<br/>Trade-off: results can be stale for the TTL, and personalized queries cache poorly."
```

The design has an indexing path that keeps the inverted index a few seconds behind the source of truth, and a query path with two services: the Search Service for submitted queries and the Suggest Service for keystrokes. Only search touches the index shards.

1. When the user submits a query, the Search Service checks the Redis query cache under a normalized key, and 60-80% of queries are answered there.
2. On a miss, the Query parser runs the same analysis chain used at index time, plus spell correction.
3. The parser scatters the query to every shard. The index is document-partitioned, so each shard holds a complete index for its share of documents.
4. Each shard scores its matches with BM25 and returns its top 20.
5. The gather step merges and re-ranks those lists into the global top 20, using hedged requests and a timeout so one slow shard can only cost partial results.
6. Hydrate adds titles, snippets and facets, caches the result, and returns it to the user.

Typeahead runs beside this. Every keystroke, debounced by 50ms, goes to the Suggest Service, which walks an in-memory trie of top-K completions per prefix in about 5ms; the trie is rebuilt offline from query logs. Documents reach the shards through the indexing path: changes in the source of truth flow through CDC into Kafka `document.changed`, the analysis pipeline tokenizes, lowercases, drops stopwords, stems and enriches them, and each document goes to the shard chosen by `hash(doc_id)`.

<!-- tab: At 100x corpus · 100B docs -->

```mermaid
flowchart TB
    User([User]) -- "every keystroke<br/>debounced 50ms" --> EdgeSuggest["Edge cache<br/>head prefixes per locale"]
    EdgeSuggest -- "miss" --> Suggest["Suggest Service<br/>tries sharded by locale + prefix"]
    User -- "on submit" --> Search[Search Service]
    Search --> QCache[("Query cache · Redis<br/>normalized key")]
    QCache -- "miss" --> Router["Query router<br/>same analysis chain as indexing<br/>prune by language, tenant, filters"]

    Router -- "1 · always" --> H0
    Router --> H1
    subgraph HOTTIER ["Hot tier · best ~2% of docs · ~40 shards"]
        direction LR
        H0[("Hot shard 0")]
        H1[("Hot shard N")]
    end

    Router -. "2 · only if too few good hits" .-> F0
    Router -.-> F1
    subgraph FULLTIER ["Full tier · 100B docs · ~2,000 shards"]
        direction LR
        F0[("Full shard 0")]
        F1[("Full shard N")]
    end

    Router -- "3 · always · small" --> Delta[("Delta index<br/>last few hours of changes")]

    H0 & H1 --> Gather
    F0 & F1 --> Gather
    Delta --> Gather
    Gather["Merge · re-rank top 500<br/>shards stop early: postings<br/>sorted by static quality<br/>hedged · partial results on timeout"]
    Gather --> Results([Results to user])

    subgraph ING ["Indexing · base + delta"]
        direction TB
        Truth[("Source of truth<br/>Postgres / Cassandra")]
        CDC{{"Kafka · document.changed"}}
        Build["Batch index build<br/>rebuild the base offline<br/>ship finished segments"]
        Truth --> CDC
        Truth --> Build
    end
    CDC -- "seconds behind" --> Delta
    Build -- "base segments" --> F0
    Build --> H0

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef external fill:#2f5a4d,stroke:#5cc98f,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    classDef scaled stroke-dasharray:5 3
    class Truth,H0,H1,F0,F1,Delta db
    class QCache cache
    class CDC queue
    class EdgeSuggest external
    class Router,Gather hot
    class EdgeSuggest,Suggest,Router,H0,H1,F0,F1,Delta,Build,Gather scaled

    click EdgeSuggest href "/docs/04-caching" "Role: serves the most common prefixes per locale from edge caches.<br/>Trade-off: edge suggestions refresh on the cache TTL, not instantly."
    click Suggest href "/docs/09-specialized-building-blocks" "Role: bounded tries sharded by locale and leading prefix.<br/>Trade-off: a query mixing scripts or locales may need two lookups."
    click Router href "/docs/03-consistency-and-distributed-systems" "Role: always queries the hot tier and the delta, and the full tier only when needed.<br/>Trade-off: a rare query pays for a second, much wider scatter."
    click H0 href "/docs/02-data-storage" "Role: a complete index of the best ~2% of documents by quality and popularity.<br/>Trade-off: tier membership is recomputed offline, so a doc that suddenly matters waits a cycle."
    click F0 href "/docs/02-data-storage" "Role: the whole corpus, partitioned so the router can skip irrelevant shards.<br/>Trade-off: thousands of shards, so only long-tail queries should reach it."
    click Delta href "/docs/02-data-storage" "Role: a small index of the last few hours of changes, read by every query.<br/>Trade-off: one more source to merge, and deletes must mask results from the base."
    click Build href "/docs/09-specialized-building-blocks" "Role: rebuilds the base index in batch and ships finished segments to shards.<br/>Trade-off: the base is hours old, so the delta index carries everything recent."
    click Gather href "/docs/08-reliability-and-operations" "Role: merges tiers and delta, then re-ranks the top 500 with expensive signals.<br/>Trade-off: stopping early can cut a relevant doc with a low static score."
```

Same engine over a 100x larger corpus. Query volume here is already web-search sized, so this tab grows the index 100x and queries about 3x. Dashed outlines mark what's new or reshaped compared with today's design.

| | Today | At 100x corpus |
|---|---|---|
| Documents | 1B | 100B |
| Index size | ~1 TB | ~100 TB |
| Shards at ~50 GB each | ~20 | ~2,000 |
| Search queries | 100k/sec | ~300k/sec |
| Typeahead | 500k/sec | ~1.5M/sec |

**What changes, and the number that forces it**

1. **Scattering to every shard stops working.** With ~2,000 shards, some shard is always slow, so p99 becomes roughly "the worst shard of the moment". Hedged requests contained tail amplification at 20 shards; at 2,000 nothing below works unless a query touches far fewer shards.
2. **A hot tier answers most queries.** Quality and popularity are power-law, so a small tier holding the best ~2% of documents (~40 shards) contains the top results for most queries. The router always asks the hot tier and only fans out to the full tier when the hot tier returns too few strong hits, which in practice means rare, long-tail queries. Most queries now touch dozens of shards, not thousands.
3. **The router prunes shards.** Full-tier shards are partitioned by values queries commonly filter on (language, tenant, category), hashed by `doc_id` within each partition. A query carrying those filters goes only to the matching shards. Still document-partitioned, but by a key the router can use.
4. **Shards stop early.** Posting lists are sorted by a static quality score, so a shard can stop once it has enough strong candidates instead of scoring every match. The gather step re-ranks the top ~500 with the expensive signals. The cost is that a relevant document with a low static score can be cut before it's ever scored.
5. **Indexing splits into a base and a delta.** Rebuilding 100B documents through the change stream one update at a time would take weeks. A batch job rebuilds the base index offline from the source of truth and ships finished segments to shards, while recent changes go into a small real-time delta index that every query also reads. Freshness stays in seconds, and a mapping change becomes a scheduled rebuild rather than an emergency.
6. **Typeahead moves toward the edge.** At ~1.5M keystrokes/sec, the head prefixes for each locale are served from edge caches, and tries are sharded by locale and leading prefix so every Suggest node holds a bounded trie.

**What stays the same**

The index is derived and never the source of truth. Index-time and query-time analysis stay identical, ranking is still BM25 layered with business signals, the query cache still normalizes keys, and partial results still beat a spinner. Sharding stays document-partitioned rather than term-partitioned.

<!-- /tabs -->

---
