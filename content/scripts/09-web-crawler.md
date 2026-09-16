# Web Crawler — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design a web crawler — the kind that feeds a search engine.

@you
Let me pin down scope, because a crawler can be a weekend script or the thing Google runs.

1. How much of the web — billions of pages? And is this one pass, or continuous?
2. What do we do with the pages — store the raw content for an indexer downstream?
3. Do we recrawl pages to keep them fresh, and does that depend on how often they change?
4. Politeness — robots.txt, crawl delays? I'd assume yes, but I want to hear it.
5. Do we render JavaScript?

@interviewer
Billions of pages, continuous. Store content for the indexing team. Yes, recrawl based on change frequency. Yes, be polite. JavaScript — you tell me.

@you
Then here's what I'm building, and what I'm not.

**Functional:** start from seed URLs, fetch pages, extract links, repeat; respect `robots.txt` and crawl-delay; avoid re-crawling identical content; recrawl on a schedule proportional to how often a page changes; store fetched content for downstream indexing.

**Non-functional:** **politeness** — never more than about one concurrent request per host, with a delay between them. **Throughput** — billions of pages at thousands of fetches a second. **Robustness** — it has to survive malformed HTML, infinite redirects and crawler traps, because the web is adversarial by accident and sometimes on purpose. **Extensible** to new content types and extractors.

**Out of scope, deliberately:** the search index itself, and ranking. JavaScript rendering I'll mention with its cost rather than design fully — it's roughly 10 to 100 times the resources of a plain fetch, so it can't be the default path.

@interviewer
Fine.

@you
Let me size it — there's a number here that picks a data structure for us.

@note · Playbook 10.1, phase 1
Politeness phrased as a hard non-functional requirement — "one concurrent request per host" — is what makes the frontier design necessary later. When the interviewer hands a question back ("you tell me"), answer with the cost that decides it.

## Estimate · 3 min · Numbers, and the set that won't fit

@you
- **Pages:** 10B.
- **Rate:** 10,000 pages/sec. 10B ÷ 10k is 1M seconds — **~11 days for a full pass**. So "finishing" is the wrong mental model; it's a continuous cycle.
- **Ingest:** ~100 KB of HTML a page is ~1 GB/sec, **~85 TB a day** raw. Compressed, in object storage.
- **URLs seen:** discovered URLs outnumber crawled pages by a lot — call it **100B+**. As strings, at ~100 bytes each, that's **10+ TB**.

The conclusion: **the URL-seen set is too large to store literally in memory**, and we check it for every link on every page — tens of thousands of lookups a second. That fact alone justifies a **Bloom filter**: at ~10 bits per URL, 100B URLs is ~125 GB, which fits in RAM across a small cluster. This is the canonical place to introduce one.

@interviewer
And 10,000 fetches a second — is that hard?

@you
Fetching fast is easy — it's embarrassingly parallel. The hard part is fetching fast **without hammering any single domain**. Ten thousand fetches a second, pointed carelessly, is a denial-of-service attack on whoever's unlucky. That's the deep dive.

@note · Playbook 10.1, phase 2
Converting 10+ TB into 125 GB with a stated bits-per-element is the estimate that introduces a data structure. And reframing "is 10k/sec hard?" as "fast is easy, polite is hard" hands you the deep-dive topic.

## API and data model · 5 min · Queue contracts, and state that's mostly caches

@you
It's an internal system, so the API is the queue contracts:

- `frontier.push(url, priority, discovered_at)`
- `frontier.pop(worker_id)` → a URL — **politeness-aware**. The worker can't get a URL whose host isn't ready.
- `content.put(url, html, fetched_at, checksum)`

@you · at the whiteboard
Seven pieces of state:

| State | Shape | The point |
|---|---|---|
| `url_seen` | Bloom filter, in RAM, sharded | a backing store confirms positives when it matters |
| `robots_cache` | domain → parsed rules | TTL ~24h |
| `dns_cache` | hostname → IPs | TTL honours the DNS record |
| `page_store` | PK `url_hash` | compressed HTML in object storage, headers, status, checksum |
| `content_hash` | simhash / checksum → canonical URL | near-duplicate detection |
| `domain_state` | domain → `last_fetch_ts`, `crawl_delay`, `error_rate` | politeness budget |
| `schedule` | PK `url_hash` | `next_crawl_at`, estimated change frequency |

@interviewer
Before a URL hits the Bloom filter, what happens to it?

@you
**Normalization**, and it matters more than it looks. `Example.com/Page?b=2&a=1#section` and `example.com/Page?a=1&b=2` are the same resource. Lowercase the host, drop the fragment, sort query parameters, resolve relative paths, strip known tracking parameters like `utm_source`. Without it, we enqueue millions of duplicates and fill the Bloom filter with noise, which raises its false-positive rate for everyone.

@interviewer
And a DNS cache — is that really a design concern?

@you
It's a hidden bottleneck. Resolution is a synchronous network call that can take 50 to 200ms, and at 10,000 fetches a second a naive crawler spends most of its time waiting on DNS. So: cache aggressively while respecting TTLs, run our own resolvers, and **resolve asynchronously ahead of fetch time** so a URL reaching the front of its queue already has an address.

@note · Playbook 10.1, phase 3
For an internal system, the queue contract *is* the API — and "politeness-aware pop" states the hard part in a function signature. DNS is the component nobody draws and everyone's crawler is bottlenecked on.

## High-level design · 10 min · A loop around the frontier

@you · drawing
The crawler is a loop around the **URL frontier**: URLs leave it, pages get fetched and parsed, new links go back in.

1. **Seed URLs** enter the frontier's **front queues**, ordered by priority.
2. They move to **back queues**, one per host.
3. **Consistent hashing by domain** routes all of a host's URLs to the same node in the **fetcher fleet**.
4. The fetcher checks the **robots cache** and **DNS cache**, then fetches with a timeout, a size cap and a redirect limit.
5. **Content dedupe**: a checksum for exact duplicates, simhash for near-duplicates. The page goes to the **page store**.
6. The **parser** extracts links and normalizes each URL.
7. The **Bloom filter** checks each one. *Definitely not seen* goes back to the frontier. *Probably seen* is dropped.

Beside the loop: **trap detection** feeding caps and patterns into the frontier, and a **recrawl scheduler** putting pages back in at their `next_crawl_at`.

@interviewer
Why hash by domain?

@you
So **politeness state is local.** If every URL for `example.com` lands on the same node, that node alone knows when it last fetched from `example.com`, its crawl delay and its robots rules — no distributed coordination per fetch, no lock service. Consistent hashing means adding or removing a node moves only about 1/N of domains rather than reshuffling all of them, so politeness state mostly stays put through scaling.

@interviewer
Recrawls cost a full fetch every time?

@you
Not if we're polite in both directions. On a recrawl, send `If-Modified-Since` and `If-None-Match` with the stored `ETag`. A **`304 Not Modified`** costs almost no bandwidth and still confirms freshness. For a recrawl-heavy workload those are nearly free pages, and site owners like us more for it.

@interviewer
Content dedupe and URL dedupe sound like the same thing.

@you
They catch different duplicates. URL dedupe stops fetching the same address twice. But different URLs frequently serve identical content — mirrors, print views, session IDs in the path. An **exact checksum** catches identical bytes. **Simhash** catches near-duplicates where only boilerplate differs, like a different ad or timestamp. Without near-duplicate detection, a real share of the downstream index would be junk.

@note · Playbook 10.1, phase 4
The loop is simple enough to draw in two minutes, which leaves room to justify the two decisions that aren't obvious: hashing by domain makes politeness local, and content dedupe is a different problem from URL dedupe.

## Deep dive · 15 min · Politeness as structure, and a Bloom filter pointed the right way

@you
The two hard parts are politeness — which shapes the frontier — and dedupe at a scale where we can't store what we've seen. Traps are a close third. I'd start with the frontier, since it's the whole design. Does that work?

@interviewer
Go.

@you
A naive FIFO queue will happily hand ten workers ten URLs from the same domain at the same moment. That's a denial-of-service attack on that site, and it gets us blocked. So the frontier has **two levels**:

| Level | Encodes | How |
|---|---|---|
| **Front queues** | priority | Q1 high — news, homepages; Q2 medium; Q3 low — chosen by a weighted selector, so low priority still moves |
| **Back queues** | politeness | **one queue per host**, and a heap keyed by `next_allowed_fetch_time` |

A worker pops from the heap, and it **can only get a URL whose host is ready**. After the fetch, the host goes back into the heap at `now + crawl_delay`. When a host's back queue empties, the router pulls more work from the front queues into it.

The point I want to make: **politeness becomes a structural property rather than a check you might forget.** There's no code path where a worker fetches too early, because the data structure won't hand it the URL.

@interviewer
What else is part of politeness?

@you
Rate is only part of it. Respect `robots.txt` and its `Crawl-delay`. Send a descriptive `User-Agent` with a contact URL, so an unhappy site admin can reach us rather than block us. Back off automatically on `429` and `503` and on a rising error rate from a host. It's not just etiquette — sites block badly behaved crawlers, and that costs coverage.

@interviewer
A site blocks you anyway.

@you
Detect it through error-rate monitoring, back off exponentially, and keep a per-domain reputation score. **Never route around a block with proxies.** That's hostile, and it's a fast way to get lawyers involved.

@you
Now dedupe. We need "have I seen this URL?" over 100B URLs, and I said a Bloom filter. The reason it fits isn't just that it's small — it's the **direction of its error**.

A Bloom filter has **no false negatives and ~1% false positives** at 10 bits per element. Translated to this problem: we will **never re-crawl a URL we've already seen** — which would be a politeness and waste problem. We **will occasionally skip a URL we haven't seen** — which costs ~1% coverage. That's the right direction for the error to point. If it were reversed, I'd reject the structure.

The limitation: you can't delete from a Bloom filter, so a URL can never be un-seen. Recrawls go through the scheduler, never through the filter.

@interviewer
What if the false-positive rate degrades?

@you
It rises as the filter fills, and past its design capacity it rises fast. So size it for the projected URL count, not today's, and **shard by URL hash** so each shard's load is bounded. Periodically rebuild a larger filter from the authoritative URL store and rotate to it. Where a false positive would really hurt — a high-priority seed — confirm the positive against the backing store.

@interviewer
Simhash at 10B pages — isn't comparison O(n²)?

@you
Naively, yes. **Locality-sensitive hashing** fixes it: split each simhash into bands and bucket pages by band, so near-duplicates collide in at least one bucket. Then we only compare within small candidate sets rather than against everything.

@interviewer
Crawler traps?

@you
Infinite calendars — `/calendar?date=2099-12-31` linking to the next day forever. Session IDs that make every visit a new URL. Deliberately deep link structures. Defenses: cap URL depth and length, cap pages per domain, detect repeating path patterns — and the best signal, **the ratio of new URLs discovered to new content found, per domain.** A domain generating a million URLs and no new content is a trap, whatever its URLs look like.

@you
And recrawl scheduling. Pages change at wildly different rates — a news homepage hourly, a 2009 forum post never. Estimate change frequency from history, set `next_crawl_at` from it, and budget capacity between **discovery** and **freshness**, because they compete for the same fetchers. How we split that budget is a product decision for the search team, not an engineering constant.

@note · Playbook 10.1, phase 5
"Politeness is structural, not a check" and "the error points the right way" are the two sentences this prompt is listening for. Both explain *why* the structure fits rather than naming it — which is the difference between depth and vocabulary.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
At 10x, **DNS resolution** and the **parser fleet** break first — usually before the fetchers. After that, the frontier's heap operations become a contention point, and one global frontier has to become per-shard frontiers.

At 100x — a million pages a second — I'd partition so almost nothing crosses the network per URL:

1. **Shard the frontier with its hosts.** Each node owns a slice of hosts and holds their queues, politeness state and seen-set together.
2. **Shard the Bloom filter the same way.** ~1.25 TB for a trillion URLs is too much to sit behind a network call per link, but ~1 GB per node is fine.
3. **Shuffle discovered links in batches** to the node owning each host, MapReduce-style, instead of a call per link.
4. **Politeness per IP, not just per host.** Thousands of small sites on one shared-hosting IP would each get their own budget and together flatten the machine.
5. **Crawl from several regions**, with hosts assigned to the region nearest their servers and regional resolvers.
6. **Store only changed content.** If a recrawl's simhash matches, store a pointer and the fetch time.

@interviewer
How do you finish 10B pages?

@you
You don't finish — it's continuous. Prioritize by estimated value — a link-authority score, change frequency, business need — so the most useful fraction of the web is always fresh, and the long tail is visited when there's capacity.

@interviewer
And JavaScript?

@you
Two tiers. Plain fetch for everything. Pages detected as JS-dependent — an empty body, a known single-page-app framework signature — go to a much smaller **rendering fleet** running headless browsers, with its own budget. Rendering everything would multiply our compute by an order of magnitude for pages that mostly didn't need it.

@you
What I'd monitor: **frontier depth**, because if parsers fall behind fetchers the frontier grows without bound — so it's also a **backpressure** signal that throttles fetchers; DNS latency; per-domain error rates and 429s, which tell me where we're being rude; Bloom filter fill ratio; the new-URL-to-new-content ratio per domain, for traps; and fetch-to-store lag. And the frontier is persistent — backed by durable storage — so a restart resumes rather than re-seeding.

@you
To close: a two-level frontier where priority lives in front and one-queue-per-host politeness lives behind, consistent hashing by domain so politeness is local, a Bloom filter whose one-sided error means we never re-crawl, and normalization plus simhash so duplicates don't eat the index. It's a loop that's easy to make fast, and this design is about making it fast without being the crawler everyone blocks.

@note · Playbook 10.5
Naming DNS as the first thing to break — not the fetchers — shows you've reasoned about where time actually goes. Backpressure framed as both a metric and a control is operational maturity in one sentence.
