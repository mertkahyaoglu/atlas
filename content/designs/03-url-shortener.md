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
  outOfScope:
    - "User accounts"
    - "Link editing"
    - "Malware scanning (mention it belongs)"
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

```erd
# Links
urls || 7-char base62 partition key, uniformly hashed
+ short_code || text || PK
+ long_url || text
+ created_at || timestamp
+ expires_at || timestamp || null
+ creator_id || bigint
+ is_custom || boolean
# Click analytics
clicks_raw || append-only: Kafka → object storage / warehouse || event log
+ short_code || text || → urls
+ ts || timestamp
+ ip_country || text
+ referrer || text
+ user_agent || text
+ device || text
clicks_agg
+ short_code || text || PK → urls
+ date || date || SK
+ count || bigint
+ top_countries || map<text,int>
+ top_referrers || map<text,int>
```

Note the partition key: `short_code` is effectively random (base62 of a hashed/encoded counter), so it distributes perfectly with no hot-partition risk. That's a rare gift — say so.

---

## High-level architecture

<!-- tab: Today · 100k redirects/s -->

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

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef gateway fill:#22565e,stroke:#38bdc1,color:#d7dee8
    classDef lb fill:#5d3759,stroke:#e066b2,color:#d7dee8
    class Store,Replica,Agg,Warehouse db
    class Cache cache
    class Clicks queue
    class WGW gateway
    class LB lb

    click Cache href "/docs/04-caching" "Role: answers most redirects from memory, keeping p99 latency low.<br/>Trade-off: deleted or expired links can keep redirecting until the TTL runs out."
    click Clicks href "/docs/05-async-messaging-and-event-driven" "Role: records clicks asynchronously so the redirect never waits on analytics.<br/>Trade-off: stats lag behind, and duplicate events must be tolerated."
    click Flink href "/docs/09-specialized-building-blocks" "Role: rolls raw clicks into windowed counts for the stats API.<br/>Trade-off: late events need watermark handling, so counts at window edges are approximate."
```

The shortener is two paths joined by one Redis cluster: a write path at about 1k requests per second that creates links, and a read path at about 100k that redirects them. A separate analytics pipeline hangs off the redirect.

1. A client's `POST /v1/urls` passes the API Gateway, which applies auth and an abuse rate limit, and reaches the Shorten Service.
2. ID generation takes the next number from a range of 10,000 that the ticket server handed out, scrambles it, and encodes it as a base62 `short_code`.
3. The urls store saves the row with a conditional write on `short_code`, and write-through copies the mapping from code to `long_url` into the Redis cluster.
4. Later, a browser's `GET /{code}` goes through the Load balancer to the Redirect Service, which is stateless and autoscaled and looks the code up in the Redis cluster.
5. About 95% of lookups hit and return 302 Found straight away. The other 5% read the urls store read replicas, populate the cache, and then return the 302.
6. The browser follows the redirect to the destination site.

Every 302 also fires a click event to Kafka and returns without waiting for it. A stream processor groups those events into tumbling windows and writes to two places: `clicks_agg`, which serves the stats API, and the data warehouse, which keeps raw analytics.

<!-- tab: At 100x · 10M redirects/s -->

```mermaid
flowchart TB
    Browser([Browser]) --> Edge["Edge worker · ~300 PoPs<br/>redirect code runs on every click"]
    Edge -- "1 · lookup" --> EdgeKV[("Edge KV · hot links<br/>short TTL · not-found entries too")]
    EdgeKV -- "~80% HIT" --> Resp["302 Found"]
    EdgeKV -- "miss" --> RegCache[("Regional Redis<br/>code → long_url")]
    RegCache -- "hit" --> Resp
    RegCache -- "miss" --> Store[("urls · sharded KV store<br/>PK = short_code<br/>replicated to every region")]
    Store -- "populate caches" --> Resp
    Store -. "unclicked for a year" .-> Cold[("Cold tier · object storage<br/>restored on first miss")]
    Resp -- "browser follows redirect" --> Dest([Destination site])

    Edge -. "2 · ~100ms batches of clicks<br/>dropped if the region is down" .-> Clicks{{"Kafka · click events<br/>one cluster per region"}}
    Clicks --> Flink["Stream processor<br/>viral codes on salted keys"]
    Flink --> Agg[("clicks_agg<br/>fast stats")]
    Flink --> Warehouse[("Data warehouse<br/>raw analytics")]

    subgraph W ["Write path · ~300k/sec, nearest region"]
        direction TB
        Creator([Client]) --> WGW[API Gateway<br/>auth · abuse rate limit]
        WGW --> Shorten[Shorten Service]
        Shorten --> IDGen["ID ranges per region<br/>disjoint prefixes, no global counter<br/>8-char base62 of scrambled counter"]
    end
    IDGen -- "conditional write" --> Store

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef external fill:#2f5a4d,stroke:#5cc98f,color:#d7dee8
    classDef gateway fill:#22565e,stroke:#38bdc1,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    classDef scaled stroke-dasharray:5 3
    class Store,Agg,Warehouse db
    class EdgeKV,RegCache cache
    class Cold blob
    class Clicks queue
    class Edge external
    class WGW gateway
    class Edge hot
    class Edge,EdgeKV,RegCache,Store,Cold,Clicks,IDGen scaled

    click Edge href "/docs/09-specialized-building-blocks" "Role: runs redirect code in every CDN point of presence, so each click is still logged.<br/>Trade-off: edge compute is billed per request, and deploys go to hundreds of locations."
    click EdgeKV href "/docs/04-caching" "Role: hot code → URL mappings and short-lived not-found entries at the edge.<br/>Trade-off: an expired or deleted link can keep redirecting until its edge TTL runs out."
    click RegCache href "/docs/04-caching" "Role: regional cache for links not hot enough to live at the edge.<br/>Trade-off: a second cache layer to invalidate on delete or expiry."
    click Store href "/docs/02-data-storage" "Role: every link, hash-partitioned on short_code and replicated to all regions.<br/>Trade-off: multi-petabyte, so rarely used links are pushed to a cold tier."
    click Cold href "/docs/09-specialized-building-blocks" "Role: links nobody has clicked for a year, in cheap object storage.<br/>Trade-off: the first click after a long sleep gets a slow redirect."
    click Clicks href "/docs/05-async-messaging-and-event-driven" "Role: regional buffer for click batches shipped from the edge.<br/>Trade-off: a batch lost with an edge node drops ~100ms of clicks."
    click Flink href "/docs/09-specialized-building-blocks" "Role: rolls raw clicks into windowed counts for the stats API.<br/>Trade-off: salted keys for viral links add a merge step downstream."
    click IDGen href "/docs/03-consistency-and-distributed-systems" "Role: hands out ID ranges from a region-specific prefix, then scrambles and encodes them.<br/>Trade-off: ranges lost when nodes die leave gaps, which are harmless."
```

Same product at 100x the traffic. Dashed outlines mark what's new or reshaped compared with today's design.

| | Today | At 100x |
|---|---|---|
| Creates at peak | 3,000/sec | 300,000/sec |
| Redirects | 100k/sec | 10M/sec |
| Storage over 5 years | ~90 TB | ~9 PB |
| Codes created | 100M/day | 10B/day |
| 7-char key space lasts | ~95 years | under 1 year |
| Where redirects are answered | a few regions | ~300 edge locations |

**What changes, and the number that forces it**

1. **Codes grow from 7 to 8 characters.** At ~10B creates/day, the 3.5 trillion 7-char codes run out in under a year. 62^8 is ~218 trillion, about 60 years at this rate. Existing 7-char links keep working, because a code's length is part of the code.
2. **Redirects move to the edge.** 10M redirects/sec served from a few regions can't hold a 50ms p99 for users far from them. An edge worker in each CDN point of presence answers from a small edge key-value store of hot links. Unlike caching the 302 response itself, the worker runs on every click, so analytics survive: this resolves the "should the CDN cache redirects?" trade-off instead of giving something up.
3. **Clicks are batched at the edge.** 10M events/sec sent one at a time would double the edge's own request volume. Workers buffer ~100ms of clicks and ship batches to the regional Kafka, dropping them if the region is unreachable, because redirect availability still outranks analytics completeness. Viral codes get salted partition keys so one link can't pin one partition.
4. **ID ranges are carved per region.** Creates go to the nearest region, and a round trip to one global ticket server would put an ocean on the write path. Each region's ticket server hands out ranges from its own prefix, so codes stay unique with no cross-region coordination.
5. **Storage becomes a sharded KV store with a cold tier.** ~9 PB over five years is well past "plan for partitioning". The urls table lives in a multi-region key-value store hash-partitioned on `short_code`, which is still a perfectly uniform key. Links nobody has clicked in a year move to object storage and are restored on their first miss.
6. **Not-found answers stop at the edge.** At this volume, scanners guessing codes are real load. Caching "not found" for a short TTL at the edge, plus per-IP limits on 404s, keeps enumeration from reaching the regions at all.

**What stays the same**

302 over 301, a scrambled counter so codes can't be enumerated, analytics that never block a redirect, a conditional write for custom aliases, and TTL expiry returning 410. The 10x follow-up already says this design scales almost linearly; at 100x each piece just moves closer to the user, and the key space gets one more character.

<!-- /tabs -->

---
