---
group: "design"
order: 3
title: "URL Shortener"
summary: "A hundred million links a day and a hundred to one read skew. The classic estimation warm-up."
hardPart: "Generating short, unique, non-guessable keys without a central bottleneck — and recognising this is a cache problem, not a database problem."
tags: ["estimation", "caching", "redis", "sharding"]
hardPartDetail: "Generating short, unique, non-guessable keys without a central bottleneck — and recognizing that this is a *cache* problem, not a database problem. It's also the classic estimation warm-up, so sloppy math is penalized heavily here."
concepts:
  - "unique ID generation"
  - "base62 encoding"
  - "extreme read:write skew"
  - "caching strategy"
  - "key-value storage"
  - "CDN/redirect semantics"
  - "analytics pipeline"
requirements:
  functional:
    - "Shorten a long URL → short code"
    - "Redirect short code → original URL"
    - "Optional custom alias"
    - "Optional expiry"
    - "Basic click analytics"
  nonFunctional:
    - "Redirect p99 < 50ms (it's in the critical path of a page load)"
    - "Very high availability — a dead shortener breaks every link ever shared"
    - "Codes must not be predictable (enumerable codes leak private links)"
    - "Redirects vastly outnumber creations"
  outOfScope: "user accounts, link editing, malware scanning (mention it belongs)."
scale:
  numbers: |-
    Creates:  100M/day  → 100M / 10^5 = 1,000/sec   (peak 3x = 3,000/sec)
    Reads:    100:1 ratio → 100,000/sec
    Storage:  ~500B/record × 100M/day = 50 GB/day → 18 TB/yr → ~90 TB over 5 yrs
    Bandwidth: 100k/sec × 500B = 50 MB/sec
    Key space: base62^7 = 3.5 × 10^12  → 100M/day for ~95 years. 7 chars is enough.
  conclusion: "(a) 3,000 writes/sec fits one tuned Postgres — don't shard on day one, but design a shardable key. (b) 90 TB doesn't fit one box, so plan for partitioning. (c) The 100:1 ratio is the headline: this is a caching problem. A cache holding the hot 20% of links serves ~95% of traffic."
tradeoffs:
  - title: "ID generation: three approaches, pick one and defend it"
    body: |-
      | Approach | How | Why / why not |
      |---|---|---|
      | **Hash the URL** (MD5 → take 7 chars) | deterministic, no coordination | Collisions are inevitable at 10^11 records; requires collision check + retry loop, and identical URLs map to the same code (sometimes desired, sometimes a privacy leak) |
      | **Counter + base62** | central or ranged counter, encode | No collisions ever, shortest possible codes. But sequential IDs are **enumerable** — scrape every link by counting up |
      | **Snowflake + base62** | 64-bit local ID | No coordination, no collisions, but 64 bits → 11 base62 chars, longer than needed |

      **The pragmatic answer:** ticket-server ranges (each app node pre-fetches 10,000 IDs and increments locally, so coordination happens once per 10,000 creates, not per create), then **scramble the counter before encoding** — XOR with a secret, or apply a Feistel permutation — so codes are unguessable while collisions remain impossible. Gaps from unused ranges when a node dies are harmless.
  - title: "Why base62"
    body: |-
      `[0-9a-zA-Z]` = 62 symbols, all URL-safe, no escaping. 62^7 ≈ 3.5 trillion. Consider excluding visually ambiguous characters (0/O, 1/l/I) if links are ever typed by hand — that drops you to base58 and you should mention the trade.
  - title: "301 vs 302 — a real question, not trivia"
    body: |-
      - **301 Permanent**: browsers cache it aggressively, so repeat clicks never touch your servers. Great for load, but you lose all analytics after the first click, and you can never change the destination.
      - **302 Found**: every click hits you. You keep analytics and can update or expire links.

      Choose **302** for an analytics product. Say why.
  - title: "Should the CDN cache redirects?"
    body: |-
      Only with short TTLs, and only if you accept losing per-click analytics for cached hits. Most shorteners skip CDN caching of the redirect itself for exactly this reason — the analytics *are* the product. This is a nice place to show that a technically-better-performing option can be the wrong product choice.
  - title: "Analytics must never be synchronous"
    body: |-
      Fire the click event to Kafka and return the 302 immediately. The user is waiting on a page load; they must not wait on an analytics write. If Kafka is down, drop the event and serve the redirect — availability of the redirect outranks completeness of analytics. That's a deliberate, statable priority.
  - title: "Caching strategy"
    body: |-
      Cache-aside with LRU + TTL. Write-through on create so a freshly-created link is warm (people click their own link immediately after shortening). Hit rate is the primary metric; it should sit above 90%.
  - title: "Custom aliases"
    body: |-
      are the one place you need strong consistency: two users must not both claim `/sale`. Use a conditional write (`IF NOT EXISTS`) rather than read-then-write, which races.
  - title: "Deletion and expiry"
    body: |-
      Don't scan for expired rows. Set a TTL on the storage row (Cassandra/DynamoDB do this natively) and check `expires_at` at read time. Return 410 Gone rather than 404 so it's distinguishable.
followUps:
  - question: "How do you prevent abuse (phishing, malware)?"
    answer: "Rate limit per account/IP at the gateway; run URLs against a reputation API asynchronously after creation and disable flagged links; add an interstitial warning page for low-reputation domains."
  - question: "Two users shorten the same URL — same code or different?"
    answer: "Different by default. Sharing a code leaks that someone else shortened it and makes per-user analytics impossible. Dedupe only if the product explicitly wants it."
  - question: "How would you shard the database?"
    answer: "Hash-partition on `short_code` — already uniform, no hot partitions, and every lookup is a point query carrying the partition key. This is the easy case; contrast it with a design where the natural key is skewed."
  - question: "What breaks at 10x?"
    answer: "Not much — this design scales almost linearly because there's no fan-out and no coordination on the read path. The realistic limits are cache memory and the click-event pipeline."
  - question: "How do you make it globally fast?"
    answer: "Read replicas per region plus regional Redis. Writes route to a home region; the read path tolerates replication lag since a link is rarely clicked in another continent milliseconds after creation."
  - question: "Custom domains for enterprise customers?"
    answer: "Cache key becomes `(domain, code)`; store the domain→tenant mapping and validate TLS via a certificate management service."
---
# 03 — URL Shortener (TinyURL / bit.ly)

## API / Model

```api
POST /v1/urls || {long_url, custom_alias?, expires_at?} || 201 {short_url}
GET /{code} || || 302 410 redirect to long_url || 410 Gone once the link has expired
GET /v1/urls/{code}/stats || || 200 click analytics
```

```schema
urls || PK: short_code || long_url, created_at, expires_at, creator_id, is_custom || 7-char base62 partition key, uniformly hashed
clicks_raw || || short_code, ts, ip_country, referrer, user_agent, device || append-only: Kafka → object storage / warehouse
clicks_agg || PK: short_code SK: date || count, top_countries, top_referrers ||
```

Note the partition key: `short_code` is effectively random (base62 of a hashed/encoded counter), so it distributes perfectly with no hot-partition risk. That's a rare gift — say so.

---

## High-level architecture

```mermaid
flowchart TB
    subgraph W ["Write path · 1k/sec"]
        direction TB
        Creator([Client]) --> WGW[API Gateway<br/>auth · abuse rate limit]
        WGW --> Shorten[Shorten Service]
        Shorten --> IDGen["ID generation<br/>ticket server hands out<br/>ranges of 10,000<br/>then base62 of scrambled counter"]
        IDGen --> Store[("urls store<br/>PK = short_code<br/>conditional write")]
    end

    subgraph R ["Read path · 100k/sec"]
        direction TB
        Browser([Browser]) --> LB[Load balancer]
        LB --> Redirect[Redirect Service<br/>stateless · autoscaled]
    end

    Cache[("Redis cluster<br/>code → long_url<br/>LRU + TTL")]
    Store -- "write-through" --> Cache
    Redirect -- "lookup code" --> Cache
    Cache -- "~95% HIT" --> Resp["302 Found"]
    Cache -- "~5% MISS" --> Replica[("urls store<br/>read replicas")]
    Replica -- "populate cache" --> Resp
    Resp -- "browser follows redirect" --> Dest([Destination site])

    Resp -. "fire and forget<br/>never blocks the redirect" .-> Clicks{{"Kafka · click events"}}
    Clicks --> Flink["Stream processor<br/>tumbling windows"]
    Flink --> Agg[("clicks_agg<br/>fast stats")]
    Flink --> Warehouse[("Data warehouse<br/>raw analytics")]

    classDef store fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    class Store,Cache,Replica,Agg,Warehouse store
    class Clicks queue

    click Cache href "/docs/04-caching" "Role: answers most redirects from memory, keeping p99 latency low.<br/>Trade-off: deleted or expired links can keep redirecting until the TTL runs out."
    click Clicks href "/docs/05-async-messaging-and-event-driven" "Role: records clicks asynchronously so the redirect never waits on analytics.<br/>Trade-off: stats lag behind, and duplicate events must be tolerated."
    click Flink href "/docs/09-specialized-building-blocks" "Role: rolls raw clicks into windowed counts for the stats API.<br/>Trade-off: late events need watermark handling, so counts at window edges are approximate."
```

<details>
<summary>Plain-text version of this diagram</summary>

```text
                           ═══ WRITE PATH (1k/sec) ═══

  [Client] ──POST /v1/urls──► ┌──────────────┐
                               │ API Gateway  │ authn, rate limit (abuse control)
                               └──────┬───────┘
                                      ▼
                          ┌────────────────────────┐
                          │   SHORTEN SERVICE       │
                          │                         │
                          │  custom alias?          │
                          │   YES → check uniqueness│
                          │   NO  → get ID ─────────┼──┐
                          │        encode base62    │  │
                          └───────────┬─────────────┘  │
                                      │                │
                                      │    ┌───────────▼─────────────┐
                                      │    │  ID GENERATION           │
                                      │    │  ┌────────────────────┐  │
                                      │    │  │ Option A: Snowflake│  │
                                      │    │  │  64-bit, local, no │  │
                                      │    │  │  coordination      │  │
                                      │    │  ├────────────────────┤  │
                                      │    │  │ Option B: Ticket   │  │
                                      │    │  │  server hands out  │  │
                                      │    │  │  ranges of 10,000  │  │
                                      │    │  │  → local increment │  │
                                      │    │  └────────────────────┘  │
                                      │    │  then: base62(id ⊕ salt) │
                                      │    │        → non-sequential  │
                                      │    └──────────────────────────┘
                                      ▼
                        ┌──────────────────────────┐
                        │  urls store              │
                        │  key-value / Cassandra   │
                        │  PK = short_code         │
                        │  (conditional write to   │
                        │   guarantee uniqueness)  │
                        └────────────┬─────────────┘
                                     │ write-through
                                     ▼
                        ┌──────────────────────────┐
                        │  Redis cache             │
                        └──────────────────────────┘


                        ═══ READ PATH (100k/sec) ═══

  [Browser] ──GET /abc1234──► ┌──────────────┐
                               │     CDN      │  cache 302 w/ short TTL
                               └──────┬───────┘  (optional; see trade-offs)
                                      │ miss
                                      ▼
                               ┌──────────────┐
                               │ Load Balancer│
                               └──────┬───────┘
                                      ▼
                        ┌──────────────────────────┐
                        │   REDIRECT SERVICE        │  stateless, autoscaled
                        └──────────┬───────────────┘
                                   │
                        ┌──────────▼───────────┐
                        │  Redis cluster        │   ~95% HIT
                        │  code → long_url      │   LRU + TTL
                        └──────┬───────┬────────┘
                          HIT  │       │ MISS (~5%)
                               │       ▼
                               │  ┌──────────────────┐
                               │  │  urls store      │
                               │  │  (read replicas) │
                               │  └────────┬─────────┘
                               │           │ populate cache
                               │           ▼
                               │      ┌──────────┐
                               └─────►│ 302 Found│──► browser follows
                                      └────┬─────┘
                                           │ fire-and-forget (async!)
                                           ▼
                                ┌────────────────────┐
                                │ Kafka "click"      │
                                └─────────┬──────────┘
                                          ▼
                        ┌────────────────────────────────┐
                        │  Stream processor (Flink)       │
                        │  tumbling windows → aggregates  │
                        └──────┬──────────────┬───────────┘
                               ▼              ▼
                     ┌────────────────┐  ┌──────────────┐
                     │  clicks_agg    │  │ Data warehouse│
                     │  (fast stats)  │  │ (raw, BigQuery)│
                     └────────────────┘  └──────────────┘
```

</details>

The shortener is two paths joined by one Redis cluster: a write path at about 1k requests per second that creates links, and a read path at about 100k that redirects them. A separate analytics pipeline hangs off the redirect.

1. A client's `POST /v1/urls` passes the API Gateway, which applies auth and an abuse rate limit, and reaches the Shorten Service.
2. ID generation takes the next number from a range of 10,000 that the ticket server handed out, scrambles it, and encodes it as a base62 `short_code`.
3. The urls store saves the row with a conditional write on `short_code`, and write-through copies the mapping from code to `long_url` into the Redis cluster.
4. Later, a browser's `GET /{code}` goes through the Load balancer to the Redirect Service, which is stateless and autoscaled and looks the code up in the Redis cluster.
5. About 95% of lookups hit and return 302 Found straight away. The other 5% read the urls store read replicas, populate the cache, and then return the 302.
6. The browser follows the redirect to the destination site.

Every 302 also fires a click event to Kafka and returns without waiting for it. A stream processor groups those events into tumbling windows and writes to two places: `clicks_agg`, which serves the stats API, and the data warehouse, which keeps raw analytics.

---
