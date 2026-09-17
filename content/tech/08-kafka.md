---
group: "tech"
order: 8
title: "Kafka"
role: "Event log"
summary: "A durable, replayable, partitioned log — the backbone of nearly every asynchronous design."
tags: ["kafka", "event-driven", "stream-processing", "outbox", "idempotency"]
---

# Kafka

## Basics

Kafka is a distributed append-only log. Producers append records to a **topic**;
consumers read forward through it. What makes it different from a queue is that
reading does not remove anything: records stay for the retention period, and any
number of independent consumers can read the same records at their own pace, from
wherever they choose.

A topic is split into **partitions**, and a partition is the unit of everything.
Ordering is guaranteed within a partition and nowhere else. Parallelism is bounded
by partition count, because within a **consumer group** each partition is assigned
to exactly one consumer. A record's key decides its partition, so all events for
one user or one order land in order on the same partition.

Each partition has a leader and replicas. `acks=all` with `min.insync.replicas=2`
means a write is acknowledged only once it is on two replicas — the setting to
name when asked about durability. A consumer's position is an **offset** it commits
back to Kafka, which is why a restarted consumer resumes rather than replays
everything.

## Key concepts and capabilities

**Replay is the superpower.** Because the log is retained, a new service can be
added and fed the last week of history, a bug can be fixed and the affected range
reprocessed, and a rebuilt search index or cache can be backfilled from the same
data the live system reads. No queue gives you this, and it is usually the reason
the answer is Kafka rather than SQS.

**Delivery semantics.** The default is at-least-once: a consumer that crashes
after handling a record but before committing its offset will see it again.
Exactly-once exists — idempotent producers plus transactions that commit offsets
and output records atomically — but it only holds inside Kafka. The moment you
write to an external database, the practical answer is at-least-once delivery with
an **idempotent consumer**: a unique key, an upsert, or a dedup table.

**Consumer lag is the health metric.** Lag is the distance between the head of the
partition and the consumer's offset. Rising lag is the early warning for
everything, and "I would alert on consumer lag" is a cheap, credible line in the
operations part of an answer.

**Log compaction** retains only the latest record per key, turning a topic into a
durable changelog you can rebuild state from — how CDC streams and stateful
processors bootstrap.

**Buffering absorbs spikes.** A producer writing 50k events/s into a consumer that
handles 10k/s does not fail; it builds lag and drains later. That decoupling of
write rate from processing rate is the structural reason to put a log between two
services.

## When to use it in an interview

Kafka belongs in a design when any of these are true:

- **Several consumers need the same events.** One write, many independent readers — a notification service, an analytics pipeline and a search indexer all off one stream.
- **Writes spike far above what downstream can absorb.** Ingest fast, process steadily: ad clicks, IoT telemetry, view events.
- **Work must survive the process doing it.** Video transcode jobs, notification sends, crawl frontiers.
- **You need history.** Event sourcing, audit, backfill, rebuilding a derived store.
- **You are publishing changes from a database.** The outbox pattern and CDC both land in Kafka.

It is the wrong tool for a request that needs an answer now — that is a
synchronous call — and heavier than needed for a simple task queue with a single
consumer and no replay, where SQS or a database-backed queue is less to run and
gives you per-message acknowledgement and native delay and retry handling.

## What interviewers push on

- **How many partitions, and what is the key?** These are the two numbers that decide ordering and scale. "Key by user id so a user's events stay ordered; 64 partitions so we can run up to 64 consumers" is the expected shape of answer.
- **Hot partitions.** A celebrity key overloads one consumer. Either accept it, add a random suffix and give up per-key ordering, or handle that key specially.
- **Duplicates.** Push on at-least-once delivery is guaranteed. Answer with an idempotency key and an upsert, not with "exactly-once".
- **Ordering across partitions.** There is none. If two events must be ordered, they must share a key.
- **Poison messages.** A record that always fails blocks the partition. Retry with backoff, then a dead letter topic, and an alert on it.
- **Kafka versus a queue.** Replay, multiple consumer groups and ordering versus per-message acks, visibility timeouts and easy delayed delivery. Say which properties the design needs.
- **What if a consumer is down for an hour?** Nothing is lost; lag grows, then it catches up — provided retention is longer than your worst outage.
