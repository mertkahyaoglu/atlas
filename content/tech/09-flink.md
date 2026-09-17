---
group: "tech"
order: 9
title: "Flink"
role: "Stream processor"
summary: "Stateful computation over unbounded streams: windows, joins and aggregates that survive a crash."
tags: ["flink", "stream-processing", "event-driven", "consistency", "realtime"]
facts:
  - label: "Shape"
    value: "A graph of operators: source → keyBy → window → sink"
  - label: "State"
    value: "Managed, keyed, RocksDB-backed — terabytes if needed"
  - label: "Fault tolerance"
    value: "Checkpoints: operator state plus source offsets, restored on failure"
  - label: "Time"
    value: "Event time, with watermarks deciding when a window is done"
  - label: "Guarantee"
    value: "Exactly-once state; end to end only with a cooperating sink"
  - label: "Upgrades"
    value: "Savepoints: stop, change the job or parallelism, restore"
capabilities:
  - title: "Event time, not processing time"
    body: |-
      Records carry the timestamp of when the thing happened. A phone offline in a tunnel delivers its events ten minutes late, and counting them in the minute they *arrived* would be wrong.

      Flink computes on event time, which is the whole reason to use it.
  - title: "Watermarks are a bet on lateness"
    body: |-
      A watermark of 12:05 asserts that no event older than 12:05 is still expected; windows fire when the watermark passes their end. Late data can be dropped, routed to a side output for reconciliation, or admitted for a grace period.

      Explaining the trade — wait longer for completeness, or emit sooner for freshness — is exactly what the interviewer wants.
  - title: "Windows"
    body: |-
      Tumbling (fixed, non-overlapping: clicks per minute), sliding (overlapping: the last 5 minutes, updated every minute), and session (grouped by gaps of inactivity: a user's browsing session).
  - title: "Joins"
    body: |-
      Stream-to-stream joins over a time window — match an ad impression to a click within 30 minutes — and stream-to-table joins that enrich events from a slowly changing reference dataset.
  - title: "Exactly-once, honestly"
    body: |-
      Inside the job, checkpoints give exactly-once state. End to end, it holds only if the sink cooperates: a transactional sink using two-phase commit, or an idempotent one where writing the same result twice is harmless.

      Say which of the two you are relying on.
  - title: "Backpressure propagates"
    body: |-
      A slow sink slows the operators upstream, which slows the source, which grows Kafka lag instead of dropping data.
useWhen:
  - "**Real-time aggregates**: clicks per campaign per minute, live view counts, trending topics"
  - "**Windowed correctness with late data**: where \"per minute\" must mean the event's minute"
  - "**Stream joins**: impression-to-click attribution, order-to-payment matching, enrichment"
  - "**Fraud and anomaly detection** over a rolling window of one user's behaviour"
  - "**Sessionisation**: turning a raw event stream into sessions"
avoidWhen:
  - "The work is stateless — transform each record and write it — where a plain Kafka consumer is simpler"
  - "Kafka Streams would do: the same ideas embedded in a service rather than a cluster"
  - "Minutes of latency are fine: that is a batch job, or Spark Structured Streaming"
probes:
  - question: "An event arrives ten minutes late."
    answer: "Watermark with a bounded delay, side output for stragglers, and a nightly batch job over the raw events in object storage that recomputes and overwrites the day's aggregates."
  - question: "You said exactly-once. To where?"
    answer: "Name the sink: transactional with two-phase commit, or idempotent. Claiming exactly-once without one is the common overreach."
  - question: "You hold a terabyte of keyed state. What does a restart cost?"
    answer: "Checkpoints take time and recovery takes longer. Use incremental checkpoints, and have a recovery time objective in mind."
  - question: "Why not just write a Kafka consumer?"
    answer: "Because you would be reimplementing windowing, checkpointing and rescaling. Say that, rather than treating Flink as automatic."
  - question: "One campaign has most of the traffic."
    answer: "A hot key overloads one task slot. Pre-aggregate locally, or split the key and combine in a second stage."
  - question: "Traffic doubled. How do you scale the job?"
    answer: "Savepoint, change parallelism, restore. That is why Flink rather than a hand-rolled stateful service."
---

# Flink

## How it works

Flink runs a graph of operators over a stream that never ends. Records flow from a
source (usually Kafka) through map, filter, keyBy, window and aggregate operators,
into a sink (an OLAP store, a key-value store, another topic). Operators run in
parallel across task slots, and a `keyBy` partitions the stream by key so all
records for one key reach the same instance.

```mermaid
flowchart TB
    K{{"Kafka<br/>source · offsets"}} --> Key["keyBy(campaign_id)"]
    Key --> Win["Tumbling window<br/>1 min, event time"]
    Win --> Agg["Aggregate<br/>keyed state in RocksDB"]
    Agg --> Sink[("Serving store<br/>idempotent sink")]
    Win -. "past the<br/>watermark" .-> Late["Side output<br/>late events"]
    Late --> Batch["Nightly recompute"]
    Agg -- "barrier" --> CP[("Checkpoint<br/>state + offsets")]

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Sink,CP db
    class K queue
    class Win hot
```

The thing that separates a stream processor from a consumer loop is **managed
state**. An operator can hold a running count, a session, or the last value per
key — potentially terabytes, backed by RocksDB on local disk — and Flink makes that
state fault-tolerant. Periodically it injects a barrier that flows through the
graph and produces a **checkpoint**: a consistent snapshot of every operator's
state plus the source offsets. On failure it restores the snapshot and rewinds the
source, so the computation continues as if nothing happened.

**Savepoints** are the same mechanism triggered by hand, which is how a job is
upgraded or rescaled without losing state.

## Where it fits in a design

Flink sits in the middle: **Kafka → Flink → a serving store**. It earns its
complexity when state is large, windows are real, and event time matters.

> The dashed path is the one interviewers follow: what happens to the events that
> arrive after you already published the number.
