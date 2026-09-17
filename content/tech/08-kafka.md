---
group: "tech"
order: 8
title: "Kafka"
role: "Event log"
summary: "A durable, replayable, partitioned log — the backbone of nearly every asynchronous design."
tags: ["kafka", "event-driven", "stream-processing", "outbox", "idempotency"]
facts:
  - label: "Model"
    value: "Append-only log; reading does not remove anything"
  - label: "Unit of everything"
    value: "The partition: ordering, parallelism and assignment"
  - label: "Ordering"
    value: "Within a partition only — the key decides the partition"
  - label: "Durability"
    value: "`acks=all` with `min.insync.replicas=2`"
  - label: "Position"
    value: "A consumer group's committed offset, so restarts resume"
  - label: "Retention"
    value: "Time or size based; compaction keeps the latest per key"
capabilities:
  - title: "Replay is the superpower"
    body: |-
      Because the log is retained, a new service can be fed the last week of history, a fixed bug can be reprocessed over the affected range, and a rebuilt index or cache can be backfilled from the same data the live system reads.

      No queue gives you this, and it is usually the reason the answer is Kafka rather than SQS.
  - title: "Delivery semantics"
    body: |-
      The default is at-least-once: a consumer that crashes after handling a record but before committing its offset sees it again.

      Exactly-once exists — idempotent producers plus transactions that commit offsets and output records atomically — but it only holds inside Kafka. The moment you write to an external database the practical answer is at-least-once plus an **idempotent consumer**: a unique key, an upsert, or a dedup table.
  - title: "Consumer lag is the health metric"
    body: |-
      Lag is the distance between the head of the partition and the consumer's offset. Rising lag is the early warning for everything, and "I would alert on consumer lag" is a cheap, credible line in the operations part of an answer.
  - title: "Log compaction"
    body: |-
      Retains only the latest record per key, turning a topic into a durable changelog you can rebuild state from — how CDC streams and stateful processors bootstrap.
  - title: "Buffering absorbs spikes"
    body: |-
      A producer writing 50k events/s into a consumer that handles 10k/s does not fail; it builds lag and drains later. That decoupling of write rate from processing rate is the structural reason to put a log between two services.
useWhen:
  - "**Several consumers need the same events**: notifications, analytics and a search indexer off one stream"
  - "**Writes spike far above what downstream absorbs**: ad clicks, IoT telemetry, view events"
  - "**Work must survive the process doing it**: transcode jobs, notification sends, crawl frontiers"
  - "**You need history**: event sourcing, audit, backfill, rebuilding a derived store"
  - "**You are publishing database changes**: the outbox pattern and CDC both land here"
avoidWhen:
  - "The caller needs an answer now — that is a synchronous call"
  - "It is a simple task queue with one consumer and no replay: SQS or a database-backed queue is less to run"
  - "You want per-message acks, visibility timeouts or native delayed delivery"
probes:
  - question: "How many partitions, and what is the key?"
    answer: "The two numbers that decide ordering and scale. \"Key by user id so a user's events stay ordered; 64 partitions so we can run up to 64 consumers\" is the expected shape."
  - question: "One celebrity key overloads a single consumer."
    answer: "Accept it, add a random suffix and give up per-key ordering, or handle that key specially. Adding partitions does not help a single key."
  - question: "Your consumer processed a record twice."
    answer: "At-least-once is the guarantee. Answer with an idempotency key and an upsert, not with \"exactly-once\"."
  - question: "These two events must be processed in order."
    answer: "Then they must share a key. There is no ordering across partitions."
  - question: "A record always fails. What happens to the partition behind it?"
    answer: "It blocks. Retry with backoff, then a dead letter topic, and an alert on that topic."
  - question: "A consumer is down for an hour."
    answer: "Nothing is lost; lag grows and it catches up — provided retention is longer than your worst outage. Say that number."
---

# Kafka

## How it works

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

```mermaid
flowchart LR
    Prod([Producers]) -- "key = user_id" --> T

    subgraph T ["Topic · 3 partitions"]
        direction TB
        P0["P0 · offsets 0…n"]
        P1["P1 · offsets 0…n"]
        P2["P2 · offsets 0…n"]
    end

    P0 --> C1["Group A · consumer 1"]
    P1 --> C2["Group A · consumer 2"]
    P2 --> C2
    P0 --> D1["Group B · indexer<br/>its own offsets"]
    P1 --> D1
    P2 --> D1

    classDef hot stroke:#e8a33d,stroke-width:2px
    class C2 hot
```

Two groups read the same partitions independently — that is the one-write,
many-readers property. Within a group, a partition belongs to exactly one
consumer, which is why partition count is your parallelism ceiling.

Each partition has a leader and replicas. `acks=all` with `min.insync.replicas=2`
means a write is acknowledged only once it is on two replicas — the setting to
name when asked about durability. A consumer's position is an **offset** it commits
back to Kafka, which is why a restarted consumer resumes rather than replays
everything.

## Where it fits in a design

A log between two services turns a synchronous dependency into a buffer with
history. The cost is that everything downstream is now eventually consistent, and
every consumer needs to be idempotent.

> "One write, many readers, and I can replay the last week" is the sentence that
> distinguishes Kafka from a queue. If you need none of that, say so and use the
> queue.
