---
group: "tech"
order: 9
title: "Flink"
role: "Stream processor"
summary: "Stateful computation over unbounded streams: windows, joins and aggregates that survive a crash."
tags: ["flink", "stream-processing", "event-driven", "consistency", "realtime"]
---

# Flink

## Basics

Flink runs a graph of operators over a stream that never ends. Records flow from a
source (usually Kafka) through map, filter, keyBy, window and aggregate operators,
into a sink (an OLAP store, a key-value store, another topic). Operators run in
parallel across task slots, and a `keyBy` partitions the stream by key so all
records for one key reach the same instance.

The thing that separates a stream processor from a consumer loop is **managed
state**. An operator can hold a running count, a session, or the last value per
key — potentially terabytes, backed by RocksDB on local disk — and Flink makes that
state fault-tolerant. Periodically it injects a barrier that flows through the
graph and produces a **checkpoint**: a consistent snapshot of every operator's
state plus the source offsets. On failure it restores the snapshot and rewinds the
source, so the computation continues as if nothing happened.

**Savepoints** are the same mechanism triggered by hand, which is how a job is
upgraded or rescaled without losing state.

## Key concepts and capabilities

**Event time, not processing time.** Records carry the timestamp of when the thing
happened. A phone offline in a tunnel delivers its events ten minutes late, and
counting them in the minute they arrived would be wrong. Flink computes on event
time, which is the whole reason to use it.

**Watermarks** are how it decides a window is done: a watermark of 12:05 asserts
that no event older than 12:05 is still expected. Windows fire when the watermark
passes their end. Late data beyond the watermark can be dropped, routed to a side
output for reconciliation, or admitted for a configured grace period. The
watermark is a bet on lateness, and explaining that trade — wait longer for
completeness, or emit sooner for freshness — is exactly what an interviewer wants.

**Windows.** Tumbling (fixed, non-overlapping: clicks per minute), sliding
(overlapping: the last 5 minutes, updated every minute), and session (grouped by
gaps of inactivity: a user's browsing session).

**Joins.** Stream-to-stream joins over a time window — match an ad impression to a
click within 30 minutes — and stream-to-table joins that enrich events from a
slowly changing reference dataset.

**Exactly-once, honestly.** Inside the job, checkpoints give exactly-once state.
End to end, it holds only if the sink cooperates: a transactional sink using
two-phase commit, or an idempotent one where writing the same result twice is
harmless. Say which of the two you are relying on.

**Backpressure** propagates naturally: a slow sink slows the operators upstream,
which slows the source, which grows Kafka lag instead of dropping data.

## When to use it in an interview

Flink appears in the middle of a pipeline: **Kafka → Flink → a serving store**. Use
it when the design needs one of these:

- **Real-time aggregates.** Ad clicks per campaign per minute, live view counts, trending topics.
- **Windowed correctness with late data.** Anything where "per minute" has to mean the event's minute, not the server's.
- **Stream joins.** Impression-to-click attribution, order-to-payment matching, enriching events with reference data.
- **Fraud and anomaly detection.** Rules over a rolling window of a user's recent behaviour, with state per user.
- **Sessionisation.** Turning a raw event stream into sessions.

If the work is stateless — transform each record and write it — a plain Kafka
consumer is simpler and you should say so. Kafka Streams is a lighter alternative
with the same ideas embedded in a service rather than a cluster, and Spark
Structured Streaming is the batch-first equivalent with higher latency. Flink earns
its complexity when state is large, windows are real, and event time matters.

## What interviewers push on

- **Late events.** The first question, every time. Watermark with a bounded delay, side output for stragglers, and a nightly batch job over the raw events in object storage that recomputes and overwrites the day's aggregates.
- **Exactly-once to the sink.** Name the transactional or idempotent sink. Claiming exactly-once without one is the common overreach.
- **State size and recovery.** A terabyte of keyed state means checkpoints take time and a restart takes longer. Incremental checkpoints, and a sense of your recovery time objective.
- **Why not just a consumer?** Because you would be reimplementing windowing, checkpointing and rescaling. Say that, rather than treating Flink as automatic.
- **Hot keys.** One campaign with most of the traffic overloads one task slot. Pre-aggregate locally, or split the key and combine in a second stage.
- **Rescaling.** Savepoint, change parallelism, restore. This is why Flink, not a hand-rolled stateful service.
