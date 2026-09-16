# Ad Click Aggregation — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design a system that aggregates ad clicks for an ad platform.

@you
Let me check who consumes these numbers, because that decides how correct they have to be.

1. Which events — clicks only, or impressions too?
2. Who reads the aggregates? A live dashboard for advertisers, historical reports, and billing?
3. What granularity — per ad per minute? Sliced by country and device?
4. If billing uses them, do they have to be exact? And can they be corrected after the fact?
5. Clicks from phones can arrive late — minutes, hours. Do those still count?

@interviewer
Clicks and impressions. All three consumers — dashboards, reports, billing. Per ad per minute, by country and device, plus campaign rollups. Billing must be exact eventually. And yes, late clicks count.

@you
Then here's what I'm building, and what I'm not.

**Functional:** ingest impressions and clicks; aggregate per `(ad_id, minute)`, per campaign, per country and device; serve near-real-time dashboards covering the last few minutes; serve historical reports over arbitrary ranges; detect and exclude fraudulent and duplicate clicks; and support billing, where the numbers must **eventually be exactly right**.

**Non-functional:** ingest **1M events a second**, spiky. Dashboards fresh to within about a minute. Billing **exact, reconcilable and auditable**. Tolerate **late-arriving events** — phones offline, retries. And **support reprocessing after a bug**, because there will be one.

**Out of scope, deliberately:** ad serving and the auction — that's a different, latency-critical system — and click prediction.

@interviewer
Numbers?

@you
Yes. And I'll flag now that "late clicks count" is the requirement the whole design is really about.

@note · Playbook 10.1, phase 1
Asking who consumes the numbers reveals two contradictory requirements — fast for dashboards, exact for billing — and the architecture is the resolution of that contradiction. "Support reprocessing after a bug" is a requirement most candidates forget to state.

## Estimate · 3 min · Too big to query, too valuable to throw away

@you
- **Events:** 1M/sec is **~86B a day**.
- **Raw size:** ~200 bytes an event is **~17 TB a day**.
- **Aggregate cardinality:** 1M active ads × 1,440 minutes is **~1.4B aggregate rows a day** — before multiplying by country and device.
- **Query load:** dashboards ~1,000 queries/sec; reports fewer but much heavier.

The conclusion: **raw events are too big to query directly, and too valuable to discard.** Scanning 17 TB a day to render a dashboard is hopeless, but the raw events are the only thing that lets us recompute correctly after a bug or a late fraud finding. So: **keep raw events in cheap storage for reprocessing, and serve queries from pre-aggregates.** That split is the architecture.

@interviewer
1.4B aggregate rows a day is still a lot.

@you
It is, which is why the aggregates themselves age. Minute granularity for recent days, rolled into hours after a few days, and into days after a few months. Nobody needs minute-level data from eighteen months ago, and the query store's size stops growing with time.

@note · Playbook 10.1, phase 2
"Too big to query, too valuable to discard" turns two numbers into an architecture in one sentence. Following up with rollups shows the aggregate layer has a lifecycle, not just a size.

## API and data model · 5 min · An immutable log, and aggregates you can overwrite

@you
Three endpoints:

- `POST /v1/events {event_id, type, ad_id, user_id, ts, country, device}` → `202`. **Fire-and-forget** from the ad server; it never blocks a page.
- `GET /v1/stats?ad_id=&from=&to=&granularity=minute|hour|day&group_by=country`.
- `GET /v1/campaigns/{id}/summary`.

The event carries **`ts` — the time the click happened**, stamped where it happened. The ingest gateway adds a receive time next to it, but never replaces it.

@you · at the whiteboard
Five pieces of state:

| State | Key | The point |
|---|---|---|
| Kafka `ad.events` | partitioned by `ad_id` | 7-day retention, the transport |
| Raw archive | object storage, by date and hour | **immutable, the source of truth for replay** |
| `aggregates` in OLAP | PK `(ad_id, minute_bucket, country, device)` | impressions, clicks, `unique_users` as an HLL sketch, spend — **upsertable** |
| Dedupe state | `event_id → seen`, in the stream processor | TTL = the late window |
| `corrections` | append-only | adjustments applied after a window closed |

The aggregate key matters: because it's `(ad, minute, dimensions)` and writes are **upserts**, a late correction replaces a row rather than appending a second one. An append-only aggregate table couldn't be corrected.

@interviewer
Why an OLAP store instead of Postgres?

@you
These queries scan billions of rows to sum a couple of columns grouped by a few dimensions. A row-oriented database reads entire rows off disk to sum one column. A **columnar** store — Druid, ClickHouse — reads only the columns referenced, compresses each column separately, which works very well because adjacent values are similar, and vectorizes the scan. Orders of magnitude difference for exactly this access pattern. And these reports should never run against a transactional database.

@note · Playbook 10.1, phase 3
Pointing out that the event carries its *own* timestamp sets up the event-time deep dive. Keying aggregates for upsert — and saying why append-only can't be corrected — is the data-model detail that makes late data possible.

## High-level design · 10 min · A hot path for speed, a cold path for truth

@you · drawing
One ingest path that splits into two.

1. **Ad servers** fire events at a **regional ingest gateway** without waiting. It validates, enriches geo and device, stamps a receive time **and keeps the event time**, and writes to **Kafka `ad.events`**, partitioned by `ad_id`.

**Hot path — seconds:**

2. **Flink** dedupes on `event_id`.
3. **Event-time windowing** into tumbling one-minute buckets — by when the click happened, not when it arrived.
4. A **watermark** decides when each bucket closes.
5. **Aggregate** counts and HyperLogLog sketches, and upsert **fast, approximate** rows into the **OLAP store**.

**Cold path — hours:**

6. Every raw event is also archived as Parquet in **object storage**, partitioned by date and hour — independently of Kafka's retention.
7. **Nightly reconciliation** recomputes yesterday from the archive, with fraud excluded, and **overwrites** the stream's numbers with the **authoritative** billing figures.

A **fraud filter** runs as a parallel stream job and **flags** suspicious clicks for that nightly run. And the **query service** serves dashboards, reports and the billing export from OLAP, with recent windows cached in Redis.

@interviewer
This sounds like Lambda architecture. Isn't that criticized for having two implementations that drift?

@you
Classic Lambda is, rightly — a stream job and a separate batch job that are supposed to agree and never quite do. What I'd build **leans Kappa**: one pipeline, and the nightly authoritative numbers come from **running the same code again** over the archived raw events. We get the correctness of a batch layer without maintaining two implementations. Same code, replayed.

@interviewer
The analytics pipeline goes down. What happens to ads?

@you
Nothing. **Ingest must never block ad serving.** The ad server fires events asynchronously; if the pipeline is down, ads still serve, and events are buffered locally or dropped. Analytics completeness is subordinate to ad delivery — an unserved ad is lost revenue for certain, a lost click event is an inaccuracy we can often recover.

@interviewer
Partitioning by `ad_id` — what about a viral ad?

@you
It concentrates on one partition and one set of stateful operators. For known-hot ads I'd **salt the key** — `ad_123#0` through `#9` — and sum the sub-aggregates downstream. We trade a merge step for even distribution.

@note · Playbook 10.1, phase 4
Answering the Lambda criticism with "same code, replayed" is the single strongest sentence in this phase. Stating that ingest never blocks ad serving is a priority order said out loud — exactly what operational maturity scoring looks for.

## Deep dive · 15 min · Event time, watermarks, and what "exactly-once" really means

@you
The hard part is **event time**: clicks arrive late, out of order, and duplicated, and advertisers are billed from these numbers. The other candidate is correctness end to end — exactly-once and dedupe. I'd start with event time. Does that work?

@interviewer
Go.

@you
A click happens at **10:00:30** on a phone in a tunnel. It arrives at our ingest at **10:07:15**.

- **Processing-time windowing** counts it in the 10:07 bucket. **Wrong.**
- **Event-time windowing** counts it in the 10:00 bucket. **Right.**

Advertisers are billed per minute and compare our numbers against their own logs. A click attributed to the wrong minute is a billing dispute. So windowing uses the event's own timestamp.

But that raises the real question: **when is the 10:00 window finished?** We can't wait forever for stragglers. That's what a **watermark** is for.

@you
A watermark is the processor's assertion: *"I believe all events with a timestamp earlier than T have now arrived."* Typically **`max observed event time − allowed lateness δ`**. When the watermark passes a window's end, the window fires and emits.

And the trade-off is explicit:

| δ | Effect |
|---|---|
| Larger | captures more stragglers, but **delays every result** by δ |
| Smaller | fresher dashboards, but drops or defers more late data |

I wouldn't guess δ. I'd measure the distribution of `arrival_time − event_time` and set δ around its p99.

@interviewer
What happens to a click that arrives after its window fired?

@you
Three tiers, and I want an answer for each:

1. **Within the watermark** — included normally.
2. **After the window fired, but within a grace period** — emit an **updated result**: a retraction and a new value. This is why the OLAP rows are upserts keyed by `(ad, minute, dimensions)`.
3. **Beyond grace** — route to a **side output**, and let the nightly recompute from the raw archive fix it. I don't want to distort the streaming pipeline chasing the long tail.

@interviewer
You keep saying exactly-once. Is Flink exactly-once?

@you
Scoped honestly: **Flink's checkpointing gives exactly-once *state* within the pipeline.** On recovery it restores operator state and rewinds Kafka offsets together, so no event is double-counted *internally*.

But the moment we write to an external store, that guarantee stops at the boundary. We need either a **transactional sink** or **idempotent upserts** keyed by `(ad_id, window, dimensions)` — so a replayed write overwrites rather than adds. End to end, it's **effectively** exactly-once, built from at-least-once delivery plus idempotent writes.

And application-level **dedupe on `event_id` is still required**, because the *ad server itself* may retry and send the same click twice. That duplicate enters Kafka as two distinct messages, which is entirely outside Flink's guarantee.

@interviewer
"Unique users who saw this ad" per hour — can you add up the minutes?

@you
No — you can't sum unique counts. The same user in two minutes would be counted twice. So I store **HyperLogLog sketches**, which are **mergeable**: the union of two sketches gives the unique count of the union, in a few kilobytes, with ~2% error. Minutes roll into hours by merging sketches.

If billing ever needs **exact** uniques, compute them in the batch recompute over raw events. That's the line between where approximation is fine — dashboards — and where it isn't.

@interviewer
The dashboard shows 1,000 clicks. The invoice says 970. The advertiser is angry.

@you
It's expected and correct, and the important thing is that it's **explainable**. The dashboard is the streaming estimate — before fraud filtering and before late corrections. Billing is the batch-reconciled figure with fraud excluded. I'd **expose both numbers** with labels rather than hide the difference, and make every excluded click traceable to its fraud flag.

@interviewer
How does the fraud filter decide?

@you
A parallel stateful stream job looking for: the same user clicking the same ad repeatedly; click-through ratios that are statistically impossible; known datacenter IP ranges; and timing too regular to be human. It **flags rather than deletes**, so every decision is auditable and reversible — if we wrongly flag a legitimate traffic source, the recompute just includes it again.

@note · Playbook 10.1, phase 5
"Exactly-once state inside Flink, idempotent upserts at the boundary, and dedupe on `event_id` for retries Flink never sees" is three levels deep into one guarantee. Claiming plain exactly-once is a specific credibility hit on this prompt.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
A 10x **spike** is mostly fine: Kafka absorbs it — that's its job — Flink task managers autoscale on consumer lag, and the OLAP write path batches naturally. Lag rising is the alert, and it rises before anything is user-visible.

Sustained 10x — 10M events a second — changes more:

1. **Exact dedupe leaves the stream.** ~36B keys of dedupe state for an hour-long late window makes checkpoints so large that recovery outlasts the failure. The stream keeps an approximate Bloom filter per time bucket; exact dedupe moves to the batch recompute, which billing already trusts.
2. **Pre-aggregate before the shuffle**, so a viral ad sends a handful of partial sums to its partition instead of millions of raw events — salting only works for hot keys you predicted.
3. **Per-region pipelines** that ship aggregates, not raw events. HLL sketches merge globally.
4. **Hourly recompute** instead of nightly, because a night can't hold 170 TB, and smaller runs fail smaller.
5. **Tiered OLAP storage**, and materialized per-advertiser summaries for dashboards.

@interviewer
A bug produced three days of wrong aggregates. How do you fix it?

@you
Fix the code, **replay from the archived raw events** into a new output table, validate it against the old one and against spot checks, then swap. Reprocessing is a first-class operation, not an emergency — that's the entire reason raw events are archived immutably.

@interviewer
And if Kafka retention had already expired?

@you
That's why the archive is independent of Kafka. **Kafka is a transport buffer; the archive is the permanent record.** Seven days of retention is for operational replay, not for history.

@interviewer
Can advertisers slice by any dimension they like?

@you
Not from pre-aggregates — those are fixed by the dimensions we chose. Ad-hoc slicing means querying raw data in the warehouse, which is slower and more expensive. That's a real product boundary, and I'd rather name it than pretend pre-aggregation is free.

@you
What I'd monitor: **Kafka consumer lag**, the leading indicator; **watermark delay** against wall clock, which shows how stale dashboards really are; the volume in the beyond-grace side output, because a jump means δ is too small or a client's clock is broken; checkpoint size and duration; the **gap between streaming and batch totals** per day, which should be small and stable; and fraud-flag rate per traffic source.

@you
To close: window by when the click happened, close windows with a watermark whose lateness we measured, update within a grace period, and leave the long tail to a recompute. The stream gives fast estimates, the same code replayed over an immutable archive gives the bill, and upserts keyed by ad, minute and dimensions are what let the second overwrite the first. Exactly-once is effectively-once, built from dedupe and idempotent writes, and I'd say that precisely rather than promise more.

@note · Playbook 10.5
Monitoring the gap between streaming and batch totals turns the Lambda-drift criticism into a metric. The close restates the event-time mechanism in order — window, watermark, grace, recompute — which is exactly what the interviewer came to assess.
