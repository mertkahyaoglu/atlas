# Search and Typeahead — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design search for a large site — full-text search plus autocomplete in the search box.

@you
Let me pin down the shape, because "search" can mean a Postgres `LIKE` or Google.

1. What are we searching — products, posts, repos? Roughly how many documents?
2. Do we need filters and facets, like category, price and date range, with counts?
3. Typeahead — are the suggestions query completions from what other people search, or document titles?
4. How fresh does the index need to be? If I publish something, when must it be searchable?
5. Personalized ranking, or the same results for everyone?

@interviewer
Documents are products and posts, about a billion. Filters and facets, yes. Suggestions are popular query completions. New documents should be searchable within seconds. No personalization for now.

@you
Then here's what I'm building, and what I'm not.

**Functional:** full-text search over a billion documents; typeahead suggestions as the user types; filters and facets; relevance ranking with pagination; typo tolerance.

**Non-functional:** typeahead p99 under **100ms**, because it fires on every keystroke. Search p99 under **300ms**. Freshness: new documents searchable within **about a second**, and I'll be precise about why it's "about". Read-heavy, very high query volume.

**Out of scope, deliberately:** personalization and learned ranking models, and image search. I'll keep ranking as a stage so a model can slot in later.

@interviewer
Okay. Numbers?

@you
Yes — and I suspect they'll tell us typeahead is the bigger system.

@note · Playbook 10.1, phase 1
Asking whether suggestions come from query logs or document titles decides whether typeahead touches the index at all. It's a one-line question that changes a whole service.

## Estimate · 3 min · Typeahead is the bigger problem

@you
- **Documents:** 1B.
- **Search:** ~100,000 queries/sec.
- **Typeahead:** it fires per keystroke, so even after debouncing it's ~5x search — **~500,000/sec**.
- **Index size:** ~1 KB indexed per document is ~1 TB, and at ~50 GB a shard that's **~20 shards**, each replicated 3x.
- **Query cache:** head queries are extremely repetitive, so a **60–80% hit rate** is realistic.

The conclusion that matters: **typeahead is a higher-volume, lower-latency problem than search itself** — five times the traffic with a third of the latency budget, and it only ever needs prefixes. So it doesn't belong on the search cluster at all. It needs a completely different data structure, an in-memory trie. Recognizing that is half the answer to this prompt.

@interviewer
Why 50 GB a shard?

@you
It's a practical sweet spot, not a law. Small enough that a shard recovers or relocates in minutes when a node dies, and large enough that we're not paying per-shard overhead a thousand times. The number that really matters is shard *count*, because every query hits every shard — and that's the deep dive.

@note · Playbook 10.1, phase 2
The best estimate on this prompt is the one that splits the system in two. "5x the volume at a third of the latency" is the sentence that justifies a separate service before anyone draws it.

## API and data model · 5 min · Two endpoints with two SLAs, and an index that isn't the truth

@you
Two endpoints, deliberately on two services:

- `GET /v1/search?q=&filters=&sort=&cursor=&limit=20` → ranked results with facets.
- `GET /v1/suggest?q=&limit=10` → completions. **Separate service, separate SLA**, so a slow search cluster can never make the search box feel laggy.

@you · at the whiteboard
Four structures:

| Structure | Shape | The point |
|---|---|---|
| Inverted index, per shard | `term → posting list` — `"distributed" → [(doc1, tf=3, positions), (doc7, tf=1), …]` | lookup by term, then intersect |
| Doc store | `doc_id → {title, snippet, url, metadata}` | hydration and display fields |
| Trie, in memory | node → **top-K completions by popularity** | precomputed at every node |
| Source of truth | Postgres or Cassandra | **the index is derived, never authoritative** |

@interviewer
Why not just a database index?

@you
`WHERE body LIKE '%distributed%'` can't use a B-tree — the leading wildcard means it scans every row, a billion of them. The inverted index flips the mapping: look up the term, get the documents. A multi-word query intersects posting lists, **starting with the shortest**, so "distributed" AND "postgres" walks the rarer list and probes the common one.

@interviewer
And the trie stores completions at every node?

@you
Yes — that's what makes it fast. A plain trie finds everything under the prefix `dis`, and then you'd have to rank thousands of completions per keystroke. Storing the top-K at each node means a lookup is a walk down three characters and a read. No ranking at query time, no disk. About 5ms.

The cost is memory and staleness, and both are fine: it's rebuilt offline from query logs, and suggestions don't need to be fresh to the second.

@note · Playbook 10.1, phase 3
Writing "the index is derived, never authoritative" in the data model sets up the freshness and reindexing answers before they're asked. Precomputed top-K per node is the detail that turns a trie from a textbook answer into a 5ms one.

## High-level design · 10 min · An indexing path, a query path, and a separate suggest service

@you · drawing
Three flows. Indexing first.

1. A write lands in the **source of truth**.
2. **CDC** — Debezium or similar — publishes `document.changed` to **Kafka**.
3. The **analysis pipeline** tokenizes, lowercases, drops stopwords, stems, and enriches.
4. The document goes to the shard chosen by `hash(doc_id)`.

The index is a few seconds behind the source, always, and the write path never depends on it.

@you
Then a submitted search.

1. The **search service** normalizes the query — lowercase, sort the filters, strip whitespace — and checks the **Redis query cache**. 60–80% end here.
2. On a miss, the **query parser** runs **the same analysis chain as indexing**, plus spell correction.
3. It **scatters to every shard**. Each shard scores its matches with **BM25** and returns its top 20.
4. **Gather** merges them into the global top 20.
5. **Hydrate** titles, snippets and facets, cache the result, return.

And typeahead, separately: every keystroke, debounced ~50ms on the client, goes to the **suggest service**, which walks its in-memory trie. It never touches the shards.

@interviewer
Why must the query parser use the same analysis chain?

@you
Because if you stem at index time and not at query time, a search for "running" never matches the indexed token "run". It's the single most common real-world search bug — and it's silent, the results just get worse. So the analysis chain is one shared, versioned definition, and changing it means reindexing.

@interviewer
Why BM25 rather than plain TF-IDF?

@you
TF-IDF says a term matters if it's frequent in this document and rare in the corpus. BM25 adds **saturation** — the fiftieth "postgres" in a page adds much less than the second, so keyword stuffing stops winning — and **length normalization**, so long documents don't win by containing every word. Then business signals like recency, popularity and quality layer on top as weights.

@interviewer
You shard by document. Why not by term, so a query only hits the shards holding its terms?

@you
It's tempting and almost always wrong. A single-term query would hit one shard. But a multi-term query has to ship huge posting lists across the network to intersect them, and a popular term like "the" or "iphone" makes one shard a brutal hotspot. **Document-partitioned** means every query hits every shard, but each shard's work is small, independent, and the system grows by adding shards. I'd take scatter-gather and deal with its cost — which is tail latency.

@note · Playbook 10.1, phase 4
Rejecting term partitioning *with the reason* is worth more than never mentioning it. And "the index is a few seconds behind, always" said during the diagram, not when challenged, is what the freshness half of the hard part is looking for.

## Deep dive · 15 min · Tail latency, freshness, and a typeahead that survives every keystroke

@you
Two hard parts here. Scatter-gather means latency is bounded by the slowest shard, so tail latency dominates. And the index lags its source of truth, which I need to be honest about. Typeahead's load is a possible third. Which first?

@interviewer
Tail latency.

@you
With 20 shards, the query's latency is the **maximum** of 20 shard latencies. If each shard is slow 1% of the time, the chance at least one of 20 is slow is about 18%. So a shard's p99 becomes roughly the query's p80. That's tail amplification, and it gets worse with every shard added.

Three mitigations:

- **Hedged requests.** If a shard hasn't answered by its p95 latency, send the same request to another replica and take whichever answers first. It costs a few percent extra load and cuts the tail dramatically, because two replicas are rarely slow at the same moment.
- **Timeout with partial results.** At the deadline, return what 19 shards gave us rather than waiting for the twentieth. Search users tolerate slightly worse results far better than a spinner.
- **Replica load balancing** away from nodes that are slow right now — a GC pause, a segment merge.

@interviewer
Page 500 of results?

@you
That's scatter-gather's worst case. Page 500 at 20 a page means every shard must return its top 10,000, so the gather merges 200,000 results to show 20. I'd use **cursor semantics** — `search_after` the last sort values — so each shard only returns the next 20 after a point. Or cap depth: most search products stop at ~1,000 results, and that's a perfectly acceptable product decision.

@interviewer
Facet counts?

@you
Aggregated per shard during the scan and merged at gather. Exact counts on high-cardinality facets — say, every brand — are expensive across 20 shards, so approximate counts or top-N facet values are the usual compromise. Nobody notices "Nike (1,204)" being off by three.

@interviewer
Private documents — say a user's own drafts?

@you
Filter **during** the scan, with an access-control field in the index — or, for strongly separated tenants, a separate index per tenant. Not post-filtering after ranking: if I rank 20 and then remove the 6 you can't see, page one has 14 results and pagination breaks.

@you
Now freshness, because the claim matters. Search engines buffer writes in memory and periodically flush them to a new immutable segment — Elasticsearch refreshes about **once a second** — and merge segments in the background. So there's always a window of roughly a second where a written document isn't searchable, plus the CDC lag in front of it. It's **near-real-time, not real-time**, and claiming otherwise is a credibility hit.

If a user must see their own new listing immediately, I'd special-case it — merge their recent writes in from the source of truth — rather than tighten the refresh interval globally, which would multiply segment count and merge work for everyone.

@interviewer
How do you reindex a billion documents after changing the analyzer, with no downtime?

@you
This is where "derived, not authoritative" pays off. Build a **new index alongside the old**, replay every document from the source of truth into it, catch up on changes since the replay started from the CDC stream, then **atomically swap an alias** from old to new. Queries never notice. Keep the old index a little while for rollback. It's only possible because the truth lives elsewhere.

@you
Typeahead, briefly. **Debounce on the client** at ~50ms and **cancel in-flight requests** when the user keeps typing — that alone cuts backend load by more than half. Prefix distribution is extremely head-heavy, so **cache at the edge**: "i", "ip", "iph" are the same for millions of people. And typo tolerance, on both services, comes from query logs — precomputed misspelling-to-correction maps, n-gram indexes for fuzzy matches, and "did you mean" rather than silently expanding a query, because edit distance over a billion documents is too expensive to do naively.

@note · Playbook 10.1, phase 5
Putting a number on tail amplification — 18% of queries hit a slow shard — makes hedging feel necessary rather than clever. And "near-real-time, not real-time" said unprompted is exactly the honesty the second half of the hard part is testing.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
At 10x, **typeahead QPS** and **scatter-gather fan-out** break first.

Typeahead is the easy one: more edge caching and more suggest replicas. The trie is read-only between rebuilds, so replicating it is cheap.

Search is harder. More documents means more shards, and **more shards makes tail latency worse**, so hedging goes from helpful to essential. And past a point — say a hundred times the corpus, ~2,000 shards — scattering to every shard stops working at all, because some shard is always slow. Then I'd change the shape:

1. A **hot tier** holding the best couple of percent of documents, which contains the top results for most queries. The full tier is only queried when the hot tier returns too few strong hits.
2. **Router pruning**: partition by fields queries commonly filter on — language, tenant, category — so a filtered query only touches matching shards.
3. **Early termination**: posting lists sorted by static quality, so shards stop once they have enough good candidates.
4. **Base plus delta indexing**: rebuild the base offline in batch, and serve recent changes from a small real-time delta index.

@interviewer
And personalization later?

@you
A **second ranking stage**. Retrieve the top ~500 with BM25 across the shards, then rescore those with a model using user features. Two-stage retrieval keeps the expensive model off the full corpus — it only ever sees 500 candidates, not a billion.

@you
What I'd monitor: **p99 search latency split by shard**, so one slow shard is visible rather than averaged away; hedge rate and partial-result rate, which tell me how often we're papering over the tail; **indexing lag** from source write to searchable; query cache hit rate; and zero-result rate, which is the cheapest relevance signal there is — a spike usually means an analysis-chain bug.

@you
To close: document-partitioned inverted index fed by CDC, queried by scatter-gather with hedging and partial results, and a completely separate in-memory trie for typeahead because it's a different problem at five times the volume. The index is always derived and always a second or so behind, which is exactly what lets us rebuild it with an alias swap. If I had another week, I'd spend it on the zero-result and click-through data, because relevance is where users actually judge search.

@note · Playbook 10.5
Saying that more shards makes latency *worse* — the fix for one limit aggravates another — is the kind of trade-off awareness this rubric scores highest. Closing on relevance metrics rather than infrastructure shows you remember what the product is for.
