---
group: "design"
order: 13
title: "Ad Click Aggregation"
summary: "A million events a second aggregated into dashboards that are fast and billing numbers that are exact."
hardPart: "Event time. Clicks arrive late, out of order and duplicated. Aggregating by arrival time is easy and wrong, and advertisers are billed from these numbers."
tags: ["stream-processing", "flink", "olap", "kafka", "dedup"]
hardPartDetail: "**Event time**. Clicks arrive late, out of order, and duplicated. Aggregating by arrival time is easy and wrong — it puts a click that happened at 10:00 into the 10:07 bucket, and advertisers are billed from these numbers. They want to see watermarks, late-data policy, and a story for correcting yesterday's totals."
concepts:
  - "stream processing"
  - "event time vs processing time"
  - "watermarks"
  - "windowing"
  - "exactly-once semantics"
  - "Lambda vs Kappa architecture"
  - "OLAP storage"
  - "deduplication at extreme volume"
  - "backfill and reprocessing"
requirements:
  functional:
    - "Ingest ad impression and click events"
    - "Aggregate counts per (ad_id, minute), per campaign, per country/device"
    - "Serve near-real-time dashboards (last few minutes)"
    - "Serve historical reports (arbitrary ranges, arbitrary dimensions)"
    - "Detect and exclude fraudulent/duplicate clicks"
    - "Support billing — numbers must eventually be *exactly* right"
  nonFunctional:
    - "Ingest 1M events/sec, spiky"
    - "Dashboard freshness: under ~1 minute"
    - "Billing accuracy: exact, reconcilable, auditable"
    - "Must tolerate late-arriving events (mobile offline, retries)"
    - "Must support reprocessing after a bug"
  outOfScope:
    - "Ad serving/auction (a different, latency-critical system)"
    - "ML click prediction"
scale:
  numbers: |-
    Events:       1M/sec → 86B/day
    Event size:   ~200B → 17 TB/day raw
    Cardinality:  1M ads × 1,440 minutes = 1.4B aggregate rows/day (before dimensions)
    Query load:   dashboards ~1,000/sec; reports lower volume, heavier
  conclusion: "Raw events are too big to query directly and too valuable to discard. So: keep raw in cheap storage for reprocessing, serve queries from pre-aggregates. That split is the architecture."
tradeoffs:
  - title: "Event time vs processing time — the core of the whole design"
    body: |-
      ```
        A click HAPPENS at 10:00:30 on a phone that's in a tunnel.
        It ARRIVES at your ingest at 10:07:15.

        Processing-time windowing → counted in the 10:07 bucket.  WRONG.
        Event-time windowing      → counted in the 10:00 bucket.  RIGHT.
      ```

      Advertisers are billed per minute and compare your numbers against their own. Attributing a click to the wrong minute is a billing dispute. Windowing must use the event's own timestamp.

      But event-time windowing raises the question: when do you decide the 10:00 window is finished? You can't wait forever. That's what watermarks are for.
  - title: "Watermarks, explained"
    body: |-
      A watermark is the processor's assertion: "I believe all events with timestamp earlier than T have now arrived." It's typically computed as `max_observed_event_time − allowed_lateness`. When the watermark passes a window's end, the window fires and emits its result.

      The trade-off is explicit and worth stating: a **larger** allowed-lateness δ captures more stragglers but delays every result by δ. A **smaller** δ gives fresher dashboards but drops or defers more late data. Pick δ from the observed distribution of arrival delay (e.g. δ = p99 of `arrival_time − event_time`), and say you'd measure it rather than guess.
  - title: "Late data policy — three tiers"
    body: |-
      Have an answer for each:
      1. *Within the watermark* — included normally.
      2. *After the window fired but within a grace period* — emit an updated result (a retraction plus a new value). Downstream stores must support upsert, which is why the OLAP layer is keyed by (ad, minute, dimensions) rather than append-only.
      3. *Beyond grace* — route to a side output and let the nightly batch job fix it. Don't distort the streaming pipeline to chase the long tail.
  - title: "Lambda vs Kappa, and why this design is Lambda-ish"
    body: |-
      - *Kappa* (stream only, reprocess by replaying) is simpler and increasingly the default.
      - *Lambda* (stream for speed, batch for truth) duplicates logic in two systems, which can drift.

      For billing, the honest answer is a **hybrid that leans Kappa**: one stream pipeline produces the live numbers, and a *reprocessing run of the same code* over archived raw events produces the authoritative nightly figures. You get the correctness of a batch layer without maintaining two separate implementations. Stating it that way — same code, replayed — shows you understand why classic Lambda is criticized.
  - title: "Exactly-once, scoped honestly"
    body: |-
      Flink's checkpointing gives exactly-once *state* semantics within the pipeline: on recovery, it restores state and rewinds Kafka offsets so no event is double-counted internally. But the moment you write to an external store, you need either a transactional sink or idempotent upserts keyed by (ad_id, window, dimensions). The end-to-end guarantee is *effectively* exactly-once, built from at-least-once delivery plus idempotent writes — the same framing as Module 5, applied to analytics.

      Application-level dedupe on `event_id` is still required, because the ad server itself may retry and send the same event twice. That's outside Flink's guarantee entirely.
  - title: "Why an OLAP store"
    body: |-
      These queries scan billions of rows to compute sums grouped by a few dimensions. A row-oriented OLTP database reads entire rows off disk to sum one column. Columnar stores read only the columns referenced, compress each column separately (very effectively, since adjacent values are similar), and vectorize the scan. Orders of magnitude difference for exactly this access pattern. Never run these reports against the transactional database.
  - title: "Pre-aggregation and rollups"
    body: |-
      Storing every raw event forever in the query store is unaffordable. Pre-aggregate at ingestion to minute granularity, then roll minutes into hours after a few days and hours into days after a few months. Query granularity degrades with age, which matches how people actually use analytics — nobody needs minute-level data from eighteen months ago.
  - title: "Unique counts need sketches"
    body: |-
      "Unique users who saw this ad" cannot be pre-aggregated by simple addition — you can't sum two unique-counts. Use **HyperLogLog** sketches, which are mergeable: the union of two sketches gives the unique count of the union, in a few KB, with ~2% error. If exact uniques are required for billing, compute them in the batch layer over raw data. This is a great place to show you know when approximation is acceptable and when it isn't.
  - title: "Ingest must never block ad serving"
    body: |-
      The ad server fires events asynchronously and does not wait. If the analytics pipeline is down, ads still serve and events are dropped or buffered locally. Analytics completeness is subordinate to ad delivery — state that priority explicitly.
  - title: "Partitioning by ad_id"
    body: |-
      Gives per-ad ordering and lets stateful operators keep per-key state locally. The risk is a hot key: one viral ad concentrates on one partition. Mitigate by salting the key for known-hot ads (`ad_123#0..9`) and summing the sub-aggregates downstream — you trade a merge step for even distribution.
followUps:
  - question: "A bug caused three days of wrong aggregates. How do you fix it?"
    answer: "Fix the code, replay from the archived raw events (or Kafka if within retention) into a new output table, validate, then swap. This is the whole reason raw events are archived immutably — reprocessing is a first-class operation, not an emergency."
  - question: "How do you detect click fraud?"
    answer: "A parallel stateful stream job: per-user click rate on the same ad, click-to-impression ratios that are statistically impossible, known datacenter IP ranges, and timing patterns too regular to be human. Flag rather than delete, so the decision is auditable and reversible."
  - question: "Dashboard shows 1,000 clicks; billing says 970. How do you explain that?"
    answer: "Expected and correct: the dashboard is the streaming estimate including unfiltered and late-corrected data; billing is the batch-reconciled figure with fraud excluded. The key is that the discrepancy is *explainable and reconcilable*, not mysterious. Expose both numbers rather than hiding the difference."
  - question: "What if Kafka retention expires before you notice a bug?"
    answer: "That's why raw events are archived to object storage independently of Kafka retention. Kafka is a transport buffer; the archive is the permanent record."
  - question: "How do you handle a 10x traffic spike?"
    answer: "Kafka absorbs it (that's its job); autoscale Flink task managers on consumer lag; the OLAP store's write path batches naturally. Lag rising is the alert, and it's a leading indicator rather than a user-visible symptom."
  - question: "Can you support arbitrary ad-hoc dimensions?"
    answer: "Not from pre-aggregates — those are fixed by the dimensions you chose. Ad-hoc slicing requires querying raw data in the warehouse, which is slower and more expensive. That's a real product boundary, and naming it is better than pretending pre-aggregation is free."
---
# 13 — Ad Click Aggregation / Real-Time Analytics

## API / Model

```api
POST /v1/events || {event_id, type, ad_id, user_id, ts, country, device} || 202 || fire-and-forget from the ad server; never blocks a page
GET /v1/stats?ad_id=&from=&to=&granularity=minute|hour|day&group_by=country || || 200 aggregated stats
GET /v1/campaigns/{id}/summary || || 200 campaign summary
```

```erd
# Raw · immutable, source of truth
ad.events || partitioned by ad_id, retention 7d || Kafka topic
+ event_id || uuid
+ type || impression | click
+ ad_id || bigint
+ user_id || uuid
+ ts || timestamp
+ country || text
+ device || text
raw archive || partitioned by date and hour; enables replay || object storage
# Dedupe state · stream processor
seen_events || TTL = watermark lag window || RocksDB
+ event_id || uuid || PK
+ seen || boolean
# Aggregates · OLAP, columnar
aggregates || Druid, ClickHouse or BigQuery
+ ad_id || bigint || PK
+ minute_bucket || timestamp || PK
+ country || text || PK
+ device || text || PK
+ impressions || bigint
+ clicks || bigint
+ unique_users || HLL sketch
+ spend || decimal
corrections || append-only record of adjustments, applied after a window closed
+ ad_id || bigint || → aggregates
+ minute_bucket || timestamp
+ delta || counts
+ created_at || timestamp
```

---

## High-level architecture

<!-- tab: Today · 1M events/s -->

```mermaid
flowchart TB
    Servers([Ad servers worldwide<br/>1M events/sec<br/>fire-and-forget: never blocks<br/>the ad response]) --> Ingest

    Ingest["Ingest gateway · regional, stateless<br/>validate · enrich geo and device<br/>attach RECEIVE time,<br/>KEEP the EVENT time"]
    Ingest --> Bus

    Bus{{"Kafka · ad.events<br/>partitioned by ad_id<br/>7-day retention"}}

    subgraph HOT ["Hot path · seconds"]
        direction TB
        Flink["Stream processor · Flink"]
        Dedup["1 · DEDUPE<br/>keyed state on event_id<br/>TTL = late window"]
        Window["2 · EVENT-TIME WINDOWING<br/>window by WHEN IT HAPPENED,<br/>not when it arrived<br/>tumbling 1-minute buckets"]
        Water["3 · WATERMARK<br/>= max_event_time − δ<br/>passes window end → EMIT<br/>late but in grace → EMIT UPDATE<br/>beyond grace → side output"]
        Agg["4 · aggregate + HyperLogLog sketches<br/>for mergeable unique counts"]
        Flink --> Dedup --> Window --> Water --> Agg
    end

    subgraph COLD ["Cold path · hours"]
        direction TB
        Archive[("Raw archive · object storage<br/>Parquet, partitioned by date/hour<br/>immutable, outlives Kafka retention")]
        Batch["Nightly reconciliation<br/>recompute yesterday from raw<br/>→ AUTHORITATIVE for billing"]
        Archive --> Batch
    end

    Bus --> Flink
    Bus --> Archive

    Agg -- "fast, approximate" --> OLAP
    Batch -- "slow, exact · OVERWRITES" --> OLAP

    OLAP[("OLAP store · Druid / ClickHouse<br/>columnar · pre-aggregated by minute<br/>rollups: minute → hour → day")]
    OLAP --> Query["Query service<br/>dashboards · reports · billing export<br/>recent windows cached in Redis"]

    Fraud["Fraud filter · parallel stream job<br/>repeat clicks · impossible CTR<br/>datacenter IPs · bot signatures<br/>FLAGS rather than deletes"] -.-> Batch
    Bus --> Fraud

    Water -. "checkpoints → exactly-once state;<br/>external writes still need<br/>idempotent upserts" .-> OLAP

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class OLAP db
    class Archive blob
    class Window,Water hot
    class Bus queue

    click Bus href "/docs/05-async-messaging-and-event-driven" "Role: the durable buffer for every ad event, partitioned by ad_id.<br/>Trade-off: 7-day retention limits how far back a replay can go."
    click Flink href "/docs/09-specialized-building-blocks" "Role: dedupes and aggregates events into minute windows in real time.<br/>Trade-off: late events need watermarks, and stateful jobs are harder to operate."
    click Archive href "/docs/09-specialized-building-blocks" "Role: immutable raw events kept beyond Kafka retention, so numbers can be recomputed.<br/>Trade-off: batch recomputation is slow, but it is the source of truth for billing."
```

Every event enters through one ingest path and then splits in two: a hot path in Flink produces approximate numbers within seconds, and a cold path recomputes exact numbers from the raw archive overnight. Both write to the same OLAP store.

1. Ad servers fire events at the regional ingest gateway without waiting for a reply. The gateway validates them, adds geo and device, stamps a receive time next to the event time, and writes to Kafka `ad.events`, partitioned by `ad_id`. Flink consumes the topic and dedupes on `event_id` first.
2. Event-time windowing puts each event in a tumbling 1-minute bucket by when it happened, not when it arrived.
3. The watermark, `max_event_time − δ`, decides when a bucket closes. Flink emits the bucket once the watermark passes its end, emits an update for a late event still within the grace period, and sends anything later to a side output.
4. Aggregation adds up counts and builds HyperLogLog sketches for unique counts, then writes the fast, approximate rows to the OLAP store.
5. The query service reads the OLAP store for dashboards, reports and the billing export, and caches recent windows in Redis.

The cold path reads the same topic. Raw events are archived as Parquet in object storage, partitioned by date and hour, and outlive Kafka's 7-day retention. Each night, reconciliation recomputes yesterday from the archive and overwrites the stream estimates in the OLAP store with the exact figures billing uses. In parallel, the fraud filter reads `ad.events` and flags suspicious clicks for that nightly run instead of deleting them.

<!-- tab: At 10x · 10M events/s -->

```mermaid
flowchart TB
    Servers([Ad servers · 10M events/sec<br/>fire-and-forget]) --> Ingest["Ingest gateway · per region<br/>validate · enrich<br/>keep the EVENT time"]
    Ingest --> Bus{{"Kafka · one cluster per region<br/>partitioned by ad_id"}}

    subgraph HOT ["Hot path · per region · seconds"]
        direction TB
        Dedup["1 · APPROXIMATE dedupe<br/>Bloom filter per time bucket<br/>exact dedupe left to batch"]
        PreAgg["2 · local pre-aggregation<br/>sum per ad, minute, dimensions<br/>BEFORE the shuffle"]
        Window["3 · event-time windows + watermark<br/>late but in grace → EMIT UPDATE<br/>incremental checkpoints"]
        Dedup --> PreAgg --> Window
    end
    Bus --> Dedup

    Window -- "regional aggregates<br/>+ HyperLogLog sketches" --> Global["Global merge<br/>ships aggregates, never raw events"]
    Global -- "fast, approximate" --> OLAP[("OLAP store · tiered<br/>recent days on local SSD<br/>older segments in deep storage")]

    subgraph COLD ["Cold path · per region · hours"]
        direction TB
        Archive[("Raw archive · object storage<br/>~170 TB/day, stays in its region")]
        Hourly["Hourly recompute<br/>exact dedupe · fraud excluded<br/>AUTHORITATIVE for billing"]
        Archive --> Hourly
    end
    Bus --> Archive
    Hourly -- "exact · OVERWRITES" --> OLAP

    Fraud["Fraud filter · stream job<br/>FLAGS rather than deletes"] -.-> Hourly
    Bus --> Fraud

    OLAP --> Query["Query service<br/>materialized per-advertiser summaries<br/>result cache for dashboards"]

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    classDef scaled stroke-dasharray:5 3
    class OLAP db
    class Archive blob
    class Bus queue
    class Window,Dedup hot
    class Ingest,Bus,Dedup,PreAgg,Global,OLAP,Archive,Hourly,Query scaled

    click Ingest href "/docs/07-apis-and-communication" "Role: regional, stateless ingest close to the ad servers.<br/>Trade-off: a pipeline per region to deploy and keep in step."
    click Bus href "/docs/05-async-messaging-and-event-driven" "Role: one Kafka cluster per region, partitioned by ad_id.<br/>Trade-off: a global view only exists after aggregates are merged."
    click Dedup href "/docs/09-specialized-building-blocks" "Role: approximate dedupe with a Bloom filter per time bucket.<br/>Trade-off: a rare false positive drops a real event from the live number until the batch corrects it."
    click PreAgg href "/docs/09-specialized-building-blocks" "Role: sums partial aggregates on each task before the network shuffle.<br/>Trade-off: an extra combine step, and the window operator never sees raw events."
    click Window href "/docs/09-specialized-building-blocks" "Role: event-time windows and watermarks, with incremental checkpoints.<br/>Trade-off: same late-data policy as today; state is smaller but still large."
    click Global href "/docs/05-async-messaging-and-event-driven" "Role: merges regional aggregates and HyperLogLog sketches into global figures.<br/>Trade-off: global numbers lag the regional ones slightly."
    click OLAP href "/docs/02-data-storage" "Role: pre-aggregated rows, recent days on SSD and older segments in deep storage.<br/>Trade-off: queries over old ranges are slower while their segments load."
    click Archive href "/docs/09-specialized-building-blocks" "Role: immutable raw events, kept in the region they arrived in.<br/>Trade-off: a global reprocessing job has to run in every region."
    click Hourly href "/docs/09-specialized-building-blocks" "Role: exact recomputation per hour, with full dedupe and fraud excluded.<br/>Trade-off: many small batch runs to schedule and monitor."
    click Query href "/docs/04-caching" "Role: serves dashboards from materialized per-advertiser summaries and a result cache.<br/>Trade-off: summaries have fixed shapes, so ad-hoc slices still hit the OLAP store."
```

Same pipeline at 10x. 10M events/sec is in the range of the largest ad platforms, so 10x is the realistic next tier. Dashed outlines mark what's new or reshaped compared with today's design.

| | Today | At 10x |
|---|---|---|
| Events | 1M/sec | 10M/sec |
| Raw volume | ~17 TB/day | ~170 TB/day |
| Aggregate rows | ~1.4B/day | ~14B/day |
| Dedupe keys for a 1-hour late window | ~3.6B | ~36B |
| Dashboard queries | ~1,000/sec | ~10,000/sec |

**What changes, and the number that forces it**

1. **Exact dedupe leaves the stream.** Keyed state on every `event_id` across an hour-long late window is ~36B keys at 10x. Checkpoints get so large that recovering from a failure takes longer than the failure lasted. The stream keeps a Bloom filter per time bucket instead: cheap, approximate, and a rare false positive only drops a real click from the live number. Exact dedupe moves to the batch recompute, which billing already treats as authoritative.
2. **Aggregation starts before the shuffle.** Salting hot keys works for a few known viral ads; at 10x there are always some you didn't predict. Each task sums counts locally per `(ad, minute, dimensions)` before the network shuffle, so a viral ad sends a handful of partial aggregates to its partition instead of millions of raw events.
3. **The pipeline runs per region.** Shipping ~170 TB/day of raw events to one place costs a fortune in cross-region bandwidth and buys nothing. Each region runs its own Kafka, stream job and raw archive, and ships only aggregates. HyperLogLog sketches are mergeable, so global unique counts still work.
4. **The batch recompute goes hourly.** A nightly recompute over ~170 TB of raw events no longer fits in a night. Recomputing each hour from the archive, once that hour's late window has closed, delivers billing corrections within hours and keeps any failed run small.
5. **The OLAP store is tiered.** 14B+ aggregate rows a day on local SSD forever isn't affordable. Recent days stay on SSD; older segments live in deep object storage and load when queried, and minute → hour → day rollups kick in sooner.
6. **Dashboards read materialized summaries.** At ~10k queries/sec, most dashboard loads ask the same per-advertiser questions. Those summaries are materialized as windows close and served from a result cache, leaving the OLAP store for reports.

**What stays the same**

Windows by event time, not processing time. Watermarks, the three-tier late-data policy, idempotent upserts keyed by `(ad, window, dimensions)`, the same code for streaming and replay, an immutable raw archive, ingest that never blocks ad serving, and fraud that flags rather than deletes. The live number is still an estimate and the batch number is still the bill; only the boundary between them moved from nightly to hourly.

<!-- /tabs -->

---
