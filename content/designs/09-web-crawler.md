---
group: "design"
order: 9
title: "Web Crawler"
summary: "Ten billion pages, ten thousand fetches a second, without hammering any single domain."
hardPart: "Politeness. Crawling fast is easy; crawling fast without overloading one host forces a queue design grouped by host rather than FIFO. Then dedupe at a scale where you can't store what you've seen."
tags: ["bloom-filter", "dedup", "consistent-hashing", "rate-limiting"]
hardPartDetail: "Politeness. Crawling fast is easy; crawling fast *without hammering any single domain* is the real constraint, and it forces a queue design where URLs are grouped by host rather than processed FIFO. The second probe is dedupe at a scale where you cannot store the set of seen URLs in memory naively."
concepts:
  - "frontier queue design"
  - "Bloom filters"
  - "politeness and per-domain rate limiting"
  - "consistent hashing"
  - "DNS caching"
  - "content deduplication"
  - "trap detection"
  - "prioritized scheduling"
  - "backpressure"
requirements:
  functional:
    - "Start from seed URLs, discover and fetch pages, extract links, repeat"
    - "Respect `robots.txt` and crawl-delay"
    - "Avoid re-crawling identical content"
    - "Recrawl pages on a schedule proportional to how often they change"
    - "Store fetched content for downstream indexing"
  nonFunctional:
    - "Politeness: never more than ~1 concurrent request per host, with delay"
    - "Throughput: billions of pages, thousands of fetches/sec"
    - "Robust: must survive malformed HTML, infinite redirects, crawler traps"
    - "Extensible: new content types and extractors"
  outOfScope:
    - "The search index itself (that's design 06)"
    - "JavaScript rendering (mention the cost)"
    - "Ranking"
scale:
  numbers: |-
    Pages to crawl:     10B
    Target rate:        10,000 pages/sec  → 10B / 10k = ~11 days for a full pass
    Avg page:           ~100 KB HTML → 1 GB/sec ingest → ~85 TB/day raw
    URLs seen (dedupe): 100B+ URLs → storing them as strings ≈ 10+ TB
                        → Bloom filter at 10 bits/URL ≈ 125 GB, fits in RAM across a cluster
  conclusion: "The URL-seen set is too large to store literally in memory. That fact alone justifies a Bloom filter, and this is the canonical place to introduce one."
tradeoffs:
  - title: "The frontier is the whole design"
    body: |-
      A naive FIFO queue will happily hand ten workers ten URLs from the same domain simultaneously, which is a denial-of-service attack against that site and gets you blocked. The two-level structure fixes this: front queues encode **priority**, back queues encode **politeness** (one per host), and a heap ordered by `next_allowed_fetch_time` means a worker can only ever pop a URL whose host is ready. Politeness becomes a structural property rather than a check you might forget.
  - title: "Consistent hashing by domain"
    body: |-
      Route all URLs for a host to the same worker node. Now politeness state (last fetch time, crawl delay, robots rules) is local — no distributed coordination per fetch. Consistent hashing means adding or removing a node moves only ~1/N of domains rather than reshuffling everything.
  - title: "Bloom filter: why it's exactly right here"
    body: |-
      You need "have I seen this URL?" over 100B URLs. Storing them costs 10+ TB. A Bloom filter at ~10 bits per element costs ~125 GB and answers in O(1) from RAM. Its guarantee is asymmetric: **no false negatives, ~1% false positives**. Translated to this problem: you will never re-crawl a page you've already crawled (which would be a correctness/politeness problem), but you will occasionally skip a page you haven't (which costs you ~1% coverage). That's the right direction for the error to point, and saying so demonstrates you understand *why* the structure fits rather than just naming it.

      The limitation to mention: you can't delete from a Bloom filter, so a URL can never be "un-seen". Handle recrawls through the scheduler, not by removing from the filter.
  - title: "URL normalization prevents an explosion"
    body: |-
      `Example.com/Page?b=2&a=1#section` and `example.com/page?a=1&b=2` are the same resource. Without normalization (lowercase host, drop fragment, sort query params, resolve relative paths, strip known tracking params), you'll enqueue millions of duplicates and your Bloom filter fills with noise.
  - title: "Content dedupe is separate from URL dedupe"
    body: |-
      Different URLs frequently serve identical content (mirrors, print views, session IDs in the path). Exact checksums catch identical bytes; **simhash** catches *near*-duplicates where only boilerplate differs. Detecting near-duplicates is what keeps the downstream index from being 40% junk.
  - title: "Crawler traps"
    body: |-
      Infinite calendars (`/calendar?date=2099-12-31` linking to the next day forever), session IDs generating unlimited unique URLs, and deliberately deep link structures. Defenses: cap URL depth and length, cap pages per domain, detect repeating path patterns, and monitor the ratio of new-URLs-discovered to useful-content-found per domain. A domain generating a million URLs and no new content is a trap.
  - title: "DNS is a hidden bottleneck"
    body: |-
      Resolution is a synchronous network call that can take 50-200ms, and at 10,000 fetches/sec a naive crawler spends most of its time in DNS. Cache aggressively (respecting TTLs), run your own resolvers, and resolve asynchronously ahead of fetch time.
  - title: "Conditional requests are free pages"
    body: |-
      Send `If-Modified-Since`/`If-None-Match` on recrawls. A `304 Not Modified` costs almost no bandwidth and confirms freshness. For a recrawl-heavy workload this is a large efficiency win.
  - title: "Recrawl scheduling"
    body: |-
      Not all pages change at the same rate. Estimate change frequency from observed history (a news homepage changes hourly; a 2009 forum post never will) and set `next_crawl_at` accordingly. Budget crawl capacity between *discovery* (new pages) and *freshness* (recrawls) — they compete for the same fetchers, and how you split is a product decision.
  - title: "Politeness beyond rate"
    body: |-
      Respect `robots.txt` and its `Crawl-delay`. Send a descriptive `User-Agent` with a contact URL. Back off automatically on 429/503 responses and rising error rates from a host. Being a well-behaved crawler is not just etiquette — sites block badly-behaved ones, which costs you coverage.
  - title: "JavaScript rendering"
    body: |-
      Many modern pages are empty without executing JS. Rendering requires a headless browser, which is roughly 10-100x the CPU and memory of a plain fetch. The practical answer is a two-tier approach: plain fetch for everything, and route only pages detected as JS-dependent (empty body, known SPA frameworks) to a smaller rendering fleet. Flag the cost explicitly rather than hand-waving it.
  - title: "Backpressure"
    body: |-
      If parsers fall behind fetchers, the frontier grows unboundedly. Monitor queue depth and throttle fetchers when it exceeds a threshold. The frontier is also persistent — it must survive restarts, so it's backed by durable storage, not just memory.
followUps:
  - question: "How do you crawl 10B pages and finish?"
    answer: "You don't \"finish\" — it's continuous. Prioritize by estimated value (PageRank-like authority, change frequency, business need) so the most useful fraction is always fresh."
  - question: "What if the Bloom filter's false positive rate degrades?"
    answer: "It rises as the filter fills. Size it for the projected URL count, and shard by URL hash so each shard's load is bounded. Rotate to a rebuilt, larger filter periodically from the authoritative URL store."
  - question: "How do you handle a site that blocks you?"
    answer: "Detect via error-rate monitoring, back off exponentially, and maintain a per-domain reputation score. Never route around a block with proxies — that's both hostile and a fast way to get legally involved."
  - question: "How do you distribute this across regions?"
    answer: "Crawl from the region nearest the content where possible (lower latency, better geo-served content), but keep the frontier and dedupe state globally consistent via domain-based partitioning."
  - question: "Duplicate detection at 10B scale — isn't simhash comparison O(n²)?"
    answer: "Yes, naively. Use LSH (locality-sensitive hashing) to bucket similar hashes so you only compare within small candidate sets."
  - question: "What breaks first at 10x?"
    answer: "DNS resolution and the parser fleet, usually before the fetchers. The frontier's heap operations also become a contention point and may need per-shard frontiers rather than one global structure."
---
# 09 — Web Crawler

## API / Model

Internal system, so the "API" is the queue contracts:

```api
# Queue contracts
frontier.push(url, priority, discovered_at)
frontier.pop(worker_id) || || url || politeness-aware
content.put(url, html, fetched_at, checksum)
```

```erd
# Frontier
url_seen || in RAM and sharded; a backing store confirms positives || Bloom filter
schedule
+ url_hash || bytes || PK → page_store
+ next_crawl_at || timestamp
+ change_frequency_estimate || interval
domain_state
+ domain || text || PK
+ last_fetch_ts || timestamp
+ crawl_delay || interval
+ error_rate || float
+ politeness_budget || int
# Caches
robots_cache || TTL ~24h || cache
+ domain || text || PK
+ rules || parsed rules
dns_cache || TTL honors the DNS record || cache
+ hostname || text || PK
+ ips || list<inet>
# Content
page_store || html is compressed, in object storage
+ url_hash || bytes || PK
+ html || object ref
+ headers || map<text,text>
+ fetched_at || timestamp
+ http_status || int
+ content_checksum || bytes || → content_hash
content_hash || simhash or checksum, for near-duplicate detection
+ checksum || bytes || PK
+ canonical_url || text
```

---

## High-level architecture

<!-- tab: Today · 10k pages/s -->

```mermaid
flowchart TB
    Seeds([Seed URLs]) --> Front

    subgraph FRONTIER ["URL Frontier"]
        direction TB
        Front["Front queues · PRIORITY<br/>Q1 high: news, homepages<br/>Q2 medium · Q3 low<br/>weighted selector"]
        Back["Back queues · POLITENESS<br/>ONE QUEUE PER HOST<br/>heap keyed by next_allowed_fetch_time<br/>a worker only pops a URL<br/>whose host is ready"]
        Front --> Back
    end
    Traps["Trap detection<br/>max depth · per-domain cap<br/>calendar and session-id patterns"] -.-> Front
    Recrawl["Recrawl scheduler<br/>estimate change frequency<br/>→ next_crawl_at"] -.-> Front

    Back -- "consistent hashing by DOMAIN<br/>all URLs for a host → one node" --> Fetchers
    Fetchers["Fetcher fleet · N nodes<br/>HTTP fetch: timeout · max size · redirect limit<br/>ETag / If-Modified-Since → 304 is free"]
    Robots[("robots.txt cache · 24h<br/>allow/deny + crawl-delay")] -.-> Fetchers
    DNS[("DNS cache<br/>a hidden bottleneck:<br/>resolution is slow and synchronous")] -.-> Fetchers

    Fetchers --> Dedupe["Content dedupe<br/>checksum → exact duplicate<br/>simhash → NEAR duplicate<br/>mirrors, boilerplate, session ids"]
    Dedupe --> PageStore[("Page store<br/>compressed HTML in object storage")]
    Dedupe --> Parser["Parser / link extractor<br/>URL normalization:<br/>lowercase host · strip fragment<br/>sort query params · resolve relative"]

    Parser --> Bloom{"URL seen? · BLOOM FILTER<br/>100B URLs at 10 bits ≈ 125 GB<br/>no false negatives · ~1% false positives"}
    Bloom -- "probably seen · skip" --> Drop([discard])
    Bloom -- "definitely not seen<br/>→ back into the frontier" --> Front

    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Robots,DNS cache
    class PageStore blob
    class Bloom,Back hot

    click Back href "/docs/05-async-messaging-and-event-driven" "Role: one queue per host, so no site is fetched faster than politeness allows.<br/>Trade-off: slow hosts cap throughput, and the number of queues grows with hosts."
    click Robots href "/docs/04-caching" "Role: avoids refetching robots.txt before every page.<br/>Trade-off: rule changes are picked up as much as 24h late."
    click DNS href "/docs/04-caching" "Role: skips slow, synchronous DNS lookups for hosts already seen.<br/>Trade-off: stale IPs after a site moves."
    click PageStore href "/docs/09-specialized-building-blocks" "Role: compressed page bodies in cheap blob storage.<br/>Trade-off: bulk storage that isn't queryable, so metadata lives elsewhere."
    click Bloom href "/docs/09-specialized-building-blocks" "Role: checks 100B URLs in memory to skip ones already crawled.<br/>Trade-off: about 1% false positives, so some genuinely new URLs are skipped."
```

The crawler is a loop around the URL Frontier: URLs leave it, pages are fetched and parsed, and new links go back in. Politeness lives inside the frontier, and duplicates are caught twice, once by content and once by URL.

1. Seed URLs enter the front queues, which order work by priority (Q1 high for news and homepages, Q2 medium, Q3 low) through a weighted selector.
2. URLs then move to the back queues, one per host. A heap keyed by `next_allowed_fetch_time` lets a worker pop a URL only when its host is ready.
3. Consistent hashing by domain sends all of a host's URLs to the same node in the fetcher fleet, which reads the robots.txt cache for rules and crawl-delay, and the DNS cache for addresses.
4. The fetcher makes the HTTP request with a timeout, a size cap and a redirect limit, and sends ETag / If-Modified-Since so an unchanged page costs only a 304.
5. Content dedupe checks a checksum for exact duplicates and a simhash for near duplicates, and the page is written to the page store as compressed HTML.
6. The parser / link extractor pulls out links and normalizes each URL: lowercase host, strip fragment, sort query params, resolve relative paths.
7. The Bloom filter checks every normalized URL. A URL that is definitely not seen goes back into the front queues, and one that is probably seen is discarded.

Two jobs feed the frontier from the side. Trap detection enforces a maximum depth and a per-domain cap and catches calendar and session-id patterns, so runaway URL spaces don't flood the queues. The recrawl scheduler estimates how often each page changes and puts it back into the front queues at its `next_crawl_at`.

<!-- tab: At 100x · 1M pages/s -->

```mermaid
flowchart TB
    Seeds([Seed URLs]) --> Assign

    Assign[("Host assignment<br/>host → region near its servers<br/>→ node by consistent hashing")]
    Assign -.-> Front

    subgraph REGION ["Each crawl region"]
        direction TB
        subgraph NODE ["Crawler node · owns a slice of hosts"]
            direction TB
            Front["Frontier shard<br/>priority queues + per-host heap<br/>for this node's hosts only"]
            Polite["Politeness per host AND per IP<br/>shared hosting = one budget<br/>back off per ASN on errors"]
            Fetch["Async fetchers<br/>thousands of connections per node<br/>ETag / If-Modified-Since"]
            BloomS{"Bloom shard · local<br/>~1 GB for this node's hosts"}
            Front --> Polite --> Fetch
        end
        DNS[("Recursive resolvers · per region<br/>resolve ahead of fetch time")]
    end
    DNS -.-> Fetch

    Fetch --> Parse["Parse · normalize URLs · simhash"]
    Parse -- "changed content" --> Store[("WARC files · object storage<br/>unchanged simhash → pointer only")]
    Parse -. "JS-dependent pages" .-> Render["Rendering fleet<br/>separately budgeted"]
    Parse --> Shuffle["Link shuffle<br/>batch discovered URLs<br/>by the node that owns their host"]
    Shuffle -- "batches to owner" --> BloomS
    BloomS -- "definitely not seen" --> Front
    BloomS -- "probably seen" --> Drop([discard])
    Recrawl["Recrawl scheduler<br/>freshness vs discovery budget"] -.-> Front

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    classDef scaled stroke-dasharray:5 3
    class Assign db
    class DNS cache
    class Store blob
    class Polite,BloomS hot
    class Assign,Front,Polite,BloomS,DNS,Shuffle,Store scaled

    click Assign href "/docs/03-consistency-and-distributed-systems" "Role: maps each host to a region near its servers, then to a node by consistent hashing.<br/>Trade-off: a host that moves servers keeps its old region until it's reassigned."
    click Front href "/docs/05-async-messaging-and-event-driven" "Role: priority queues and the per-host heap for this node's hosts only.<br/>Trade-off: moving hosts between nodes means moving their queues too."
    click Polite href "/docs/08-reliability-and-operations" "Role: politeness budgets per host and per IP, with per-ASN backoff on errors.<br/>Trade-off: many sites sharing one IP crawl slower than each would alone."
    click BloomS href "/docs/09-specialized-building-blocks" "Role: this node's slice of the seen-set, next to the frontier that uses it.<br/>Trade-off: resharding hosts means rebuilding their filter slices from the URL store."
    click DNS href "/docs/04-caching" "Role: each region's own recursive resolvers, resolving before fetch time.<br/>Trade-off: resolver fleets to run in every region."
    click Shuffle href "/docs/05-async-messaging-and-event-driven" "Role: batches discovered URLs by the node that owns their host.<br/>Trade-off: a new link waits for its batch before it can be scheduled."
    click Store href "/docs/09-specialized-building-blocks" "Role: compressed WARC files for pages whose content actually changed.<br/>Trade-off: reading a page's history means following pointers back to its last change."
```

Same crawler at 100x the fetch rate: a full pass over 100B known pages in about a day instead of eleven days for 10B. Dashed outlines mark what's new or reshaped compared with today's design.

| | Today | At 100x |
|---|---|---|
| Fetch rate | 10k pages/sec | 1M pages/sec |
| Known pages | 10B | 100B |
| URLs seen | 100B+ | ~1T |
| Bloom filter at 10 bits/URL | ~125 GB | ~1.25 TB |
| Raw ingest | ~85 TB/day | ~8.6 PB/day |
| Full pass | ~11 days | ~1 day |

**What changes, and the number that forces it**

1. **The frontier is sharded along with its hosts.** One global heap popping 1M URLs/sec becomes a contention point before anything else, as the 10x follow-up warns. Each crawler node owns a slice of hosts by consistent hashing and holds their frontier queues, politeness state and seen-set together. Popping a URL, checking politeness and checking "seen" are all local memory operations.
2. **The seen-set shards with the frontier.** ~1T URLs at 10 bits each is ~1.25 TB, too much to sit behind a network call for every extracted link. Partitioning the Bloom filter by host puts ~1 GB on each node, right next to the frontier that needs it.
3. **Discovered links are shuffled in batches.** Most links point at other hosts, which belong to other nodes. The parser groups discovered URLs by owning node and ships them in batches, and the owner does the Bloom check and enqueue. It's a MapReduce-style shuffle, not a network call per link.
4. **Politeness counts IPs, not just hostnames.** At 1M pages/sec, thousands of small sites on one shared-hosting IP would each get their own "one request at a time" budget and together overwhelm the machine. Budgets apply per host and per IP, and error rates trigger backoff per ASN.
5. **Crawling runs in several regions.** Fetching a Brazilian site from Virginia adds latency to every request and sees the wrong geo-served content. Hosts are assigned to the region closest to their servers, and each region runs its own recursive resolvers that resolve ahead of fetch time. DNS is otherwise the first thing to break.
6. **Only changed content is stored.** 8.6 PB/day of raw HTML is mostly pages that didn't change since the last crawl. When a recrawl's simhash matches the stored version, only a pointer and the fetch time are recorded; changed pages are written as compressed WARC files to object storage.

**What stays the same**

The two-level frontier that makes politeness structural, consistent hashing by domain, a Bloom filter that never re-crawls a seen URL, URL normalization, trap detection, conditional requests that make unchanged pages nearly free, and JavaScript rendering on its own smaller fleet. The loop is identical; it's just partitioned so that almost nothing in it crosses the network per URL.

<!-- /tabs -->

---
