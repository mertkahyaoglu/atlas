# URL Shortener — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design a URL shortener, like bit.ly.

@you
Let me agree the shape first — this prompt is small enough that the requirements are most of the difference between designs.

1. Core flow is shorten a long URL, then redirect the short code to it. Do users get to choose a custom alias?
2. Do links expire?
3. Is this an analytics product — do people want click counts — or purely a redirect?
4. Do we need accounts, and can a link's destination be edited after creation?

@interviewer
Custom aliases, yes. Optional expiry. Basic click analytics matter — that's how bit.ly makes money. No accounts, no editing.

@you
Then here's what I'm building, and what I'm not.

**Functional:** shorten a long URL into a short code; redirect a code to its URL; an optional custom alias; an optional expiry; basic click analytics per link.

**Non-functional:** redirect p99 under **50ms**, because it sits in the critical path of somebody's page load. **Very high availability** — a dead shortener breaks every link anyone has ever shared, in emails and printed on posters, so it's worse than most outages. Codes must **not be predictable**: if codes can be enumerated, anyone can scrape private links like shared documents. And redirects vastly outnumber creations.

**Out of scope, deliberately:** user accounts and link editing. Malware and phishing scanning is out of scope for today, but I want to say it belongs in a real system — a shortener is a very attractive way to disguise a bad URL.

@interviewer
Good. Numbers?

@you
Yes — and I'll be careful with them, since this is the prompt where the math matters most.

@note · Playbook 10.1, phase 1
"Codes must not be predictable" is the requirement that changes the ID design later, and it only appears if you ask what the links are used for. Naming malware scanning as out of scope *but belonging* shows you know the real product.

## Estimate · 3 min · Five numbers, three conclusions

@you
I'll use 10^5 seconds in a day to keep the arithmetic clean.

- **Creates:** 100M links a day ÷ 10^5 is **1,000/sec**, and ~3,000/sec at a 3x peak.
- **Redirects:** at 100:1 read:write, **100,000/sec**.
- **Storage:** ~500 bytes per record × 100M a day is 50 GB/day, ~18 TB a year, **~90 TB over five years**.
- **Bandwidth:** 100k redirects/sec × ~500 bytes is ~50 MB/sec. Not a concern.
- **Key space:** base62 over 7 characters is 62^7 ≈ 3.5 × 10^12. At 100M a day that lasts ~95 years. **Seven characters is enough.**

@you
Three conclusions. First, 3,000 writes/sec fits one well-tuned Postgres — I won't shard on day one, but I'll pick a key that shards cleanly. Second, 90 TB doesn't fit on one box forever, so partitioning is on the plan even if not on day one. Third, and this is the headline: **the 100:1 ratio makes this a caching problem, not a database problem.** Link popularity is heavily skewed, so a cache holding the hot 20% of links serves ~95% of redirects.

@interviewer
How big is that cache?

@you
At ~500 bytes an entry, 500M hot links is ~250 GB — a modest Redis cluster. I wouldn't size it by a fraction of all links though; I'd size it by hit rate, which is the metric I'd actually watch. If it drops below ~90%, the cache is too small or the TTL is too short.

@note · Playbook 10.1, phase 2
Sloppy math is penalized most on this prompt. Round deliberately (10^5 seconds a day), state the key-space conclusion as a number of years, and end on the sentence that reframes the problem: it's a cache problem.

## API and data model · 5 min · Three endpoints and a partition key that's a gift

@you
Three endpoints:

- `POST /v1/urls {long_url, custom_alias?, expires_at?}` → `201 {short_url}`.
- `GET /{code}` → `302` to the long URL, or **`410 Gone`** if it's expired — distinguishable from a `404` for a code that never existed.
- `GET /v1/urls/{code}/stats` → click analytics.

@you · at the whiteboard
Three tables:

| Table | Key | The point |
|---|---|---|
| `urls` | PK `short_code` | `long_url`, `created_at`, `expires_at`, `creator_id`, `is_custom` |
| `clicks_raw` | append-only | `short_code`, `ts`, `ip_country`, `referrer`, `user_agent` — Kafka to object storage and the warehouse |
| `clicks_agg` | PK `short_code`, SK `date` | `count`, `top_countries`, `top_referrers` for the stats API |

The partition key is worth pointing at. `short_code` is effectively random — base62 of a scrambled counter — so it distributes perfectly, with no hot partitions, and every lookup is a point query carrying the key. That's a rare gift. Most designs have to fight a skewed natural key; this one doesn't.

@interviewer
If I shorten the same URL twice, do I get the same code?

@you
Different codes by default. A shared code leaks that someone else already shortened that URL — which, for a private document link, is a real leak — and it makes per-creator analytics impossible because two campaigns share one counter. I'd dedupe only if the product explicitly wants it.

@interviewer
301 or 302?

@you
That's a real product question, not trivia. A **301** is permanent: browsers cache it aggressively, so repeat clicks never reach us. Great for load — but we lose analytics after the first click, and we can never expire or change the destination. A **302** means every click hits us: we keep analytics, and expiry actually works.

The analytics are the product, so **302**. I'm choosing the option with more load because the cheaper one breaks the business.

@note · Playbook 10.3
"I'm choosing X over Y. X gives us…, the cost is…, and that's right because of the product requirement" — the 301/302 answer is that sentence exactly. A technically cheaper option that removes the revenue is the wrong option.

## High-level design · 10 min · A small write path, a huge read path, one cache between them

@you · drawing
Two paths joined by one Redis cluster, plus an analytics pipeline hanging off the side. The write path first, at ~1,000/sec.

1. `POST /v1/urls` hits the **API gateway** — auth and an abuse rate limit — and reaches the **shorten service**.
2. **ID generation** takes the next number from a local range, scrambles it, and encodes it as a 7-character base62 code. I'll go deep on this.
3. The row goes into the **urls store** with a conditional write on `short_code`.
4. **Write-through** puts `code → long_url` into Redis immediately, because people click their own link seconds after shortening it.

@you
Then the read path, at 100,000/sec.

1. A browser's `GET /{code}` goes through a **load balancer** to the **redirect service** — stateless, autoscaled.
2. Look the code up in **Redis**. About 95% of the time it's a hit: check `expires_at`, return `302`.
3. On a miss, read a **read replica** of the urls store, populate the cache, return `302`.
4. And separately: **fire a click event to Kafka and don't wait for it.**

A **stream processor** rolls those events into tumbling windows for `clicks_agg`, which serves the stats API, and writes raw events to the warehouse.

@interviewer
What if Kafka is down?

@you
Drop the event and serve the redirect. That's a deliberate priority I want to state: **availability of the redirect outranks completeness of analytics.** The person clicking is waiting on a page load, and they must never wait on an analytics write. Losing some clicks during a Kafka outage shows up as a dip in a chart; a slow or failing redirect breaks every link on the internet that points at us.

@interviewer
Why not put the redirects on a CDN? That would take most of the load.

@you
Only with short TTLs, and only if we accept losing per-click analytics for cached hits — a CDN-cached 302 never reaches us, which is the 301 problem again. Most shorteners skip caching the redirect itself at the CDN for exactly that reason. It's a nice example of the faster option being the wrong product choice.

Where I'd use the edge, if we needed to, is running redirect *code* at the edge — a worker that answers from an edge key-value store and still logs every click. That keeps analytics and gets the latency. But at 100k/sec from a few regions, I don't need it yet.

@note · Playbook 10.1, phase 4
Saying the degradation order out loud — redirect first, analytics second — is operational maturity scored in the middle of the design, not saved for the end. When you turn down the CDN, name what *would* make you use the edge, so it reads as judgment rather than a gap.

## Deep dive · 15 min · Keys that are short, unique and unguessable

@you
The genuinely hard part is generating keys that are short, unique and not guessable, without a central bottleneck on every create. The other candidate is the caching strategy in detail. I'd suggest key generation — does that work for you?

@interviewer
Go.

@you
There are three standard approaches, and each fails one of our requirements:

| Approach | How | Why not, on its own |
|---|---|---|
| **Hash the URL** — MD5, take 7 chars | deterministic, no coordination | collisions are inevitable at 10^11 records, so every create needs a check-and-retry loop; and identical URLs map to the same code, which leaks |
| **Counter + base62** | increment, encode | no collisions ever, shortest codes — but **sequential codes are enumerable**, so anyone can scrape every link by counting |
| **Snowflake + base62** | 64-bit ID made locally | no coordination and no collisions, but 64 bits is 11 base62 characters, longer than we need |

@you
So I'd combine the counter's properties with the fix for its flaw.

**Ticket-server ranges.** A small ticket service hands each shorten node a range of 10,000 IDs. The node increments locally in memory. Coordination happens once per 10,000 creates instead of on every create, so at 3,000/sec the ticket server sees a request every few seconds per node. If a node dies holding half a range, those IDs are simply never used — gaps are harmless, uniqueness is all we need.

**Scramble before encoding.** Then pass the counter through a keyed permutation — a small Feistel network, or at minimum an XOR with a secret — before base62. A permutation is a bijection, so distinct counters still give distinct codes: **collisions stay impossible**. But consecutive counters now map to codes that look random, so you can't enumerate by counting.

@interviewer
If the ticket server dies?

@you
Nodes keep issuing from the ranges they already hold, so creates continue for minutes — at 1,000/sec across a fleet, 10,000 IDs per node goes a long way. Redirects don't touch it at all. And the ticket server's state is one number, so it's trivially replicated: a Postgres sequence on a primary with a synchronous standby, or two servers handing out odd and even ranges. It's a single point of coordination, but not a single point of failure for redirects.

@interviewer
Custom aliases. Two users both want `/sale`.

@you
This is the one place I need strong consistency. **Read-then-write races** — both users read "free", both write, one silently overwrites the other. So I use a **conditional write**: `INSERT … IF NOT EXISTS`, or a unique constraint in Postgres. Exactly one succeeds; the other gets a `409` and picks a different alias.

Custom aliases also share the key space with generated codes, so I'd reserve a shape for them — say generated codes are always exactly 7 characters, and aliases must be a different length or contain a character generated codes never use. Otherwise a generated code could one day collide with an alias someone chose.

@you
And base62 itself — `[0-9a-zA-Z]`, 62 symbols, all URL-safe with no escaping. If links are ever typed by hand, I'd drop the ambiguous characters — `0` and `O`, `1`, `l` and `I` — which is base58, and costs a slightly longer code for the same key space. Worth mentioning because it's a product call.

@you
Now caching, briefly, since it's the other half. **Cache-aside with LRU plus a TTL**, and write-through on create. Hit rate is the primary metric and should sit above 90%.

Expiry is where people go wrong. **Don't scan for expired rows.** Set a TTL on the storage row — Cassandra and DynamoDB do it natively — and check `expires_at` at read time, returning `410`. The cache TTL bounds how long an expired link could still redirect, so I'd cap the cache TTL at the link's remaining lifetime when I write the entry.

@interviewer
How would you shard the store when you need to?

@you
Hash-partition on `short_code`. It's already uniform, so there are no hot partitions, and every lookup carries the partition key. This is the easy case — worth contrasting with designs where the natural key is skewed, like a feed partitioned by a celebrity.

@note · Playbook 10.1, phase 5
Laying out three approaches in a table and saying which requirement each one fails is how you show you chose rather than recited. The winning move — ranges plus a keyed permutation — takes the counter's "never collides" and removes its "enumerable", and that's the sentence to land.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
Honestly, at 10x not much breaks. There's no fan-out and no coordination on the read path, so this scales almost linearly — more redirect nodes, more cache. The realistic limits are **cache memory**, because the hot set grows with total links, and the **click-event pipeline**, because viral links concentrate events on one partition key. I'd salt the key for hot codes and merge downstream.

At 100x, three things change. At ~10B creates a day, **7 characters runs out in under a year**, so codes grow to 8 — 62^8 is ~60 years at that rate, and old 7-character codes keep working because length is part of the code. Redirects move to **edge workers** to hold 50ms globally. And ID ranges are **carved per region** with disjoint prefixes, so creates don't cross an ocean to reach one ticket server.

@interviewer
How do you make it fast globally before 100x?

@you
Read replicas and a regional Redis per region. Writes route to a home region. The read path tolerates replication lag because a link is almost never clicked on another continent within milliseconds of being created — and if it is, the miss falls through to the home region.

@interviewer
And abuse — phishing links?

@you
Rate limit creates per account and per IP at the gateway. After creation, check the destination against a reputation API **asynchronously**, and disable flagged links — never block the create on it. For low-reputation domains, redirect through an interstitial warning page instead of a straight 302.

@you
What I'd monitor: **cache hit rate**, the leading indicator for redirect latency; redirect p99 split by hit and miss; the **404 rate per IP**, because someone guessing codes is either a scraper or an attack; click-pipeline consumer lag and the dropped-event count, so a Kafka outage is visible rather than silently under-counting; and remaining ticket ranges.

@you
To close: this is a caching problem wearing a database costume. The two decisions that matter are a key generator that's a scrambled, range-allocated counter — unique by construction, unguessable by permutation, coordinated once per ten thousand creates — and a read path that returns a 302 from memory and never waits on analytics. Everything else scales by adding nodes.

@note · Playbook 10.5
"Not much breaks at 10x" is a fine answer when you can prove it — no fan-out, no coordination on the read path — and then name the two real limits anyway. Claiming a design has *no* bottlenecks is the credibility hit; saying it scales linearly and showing why isn't.
