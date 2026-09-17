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
concepts:
  - "**The partition is the unit** — of ordering, of parallelism, and of assignment within a consumer group"
  - "**The key picks the partition**, so everything for one user or order stays ordered together"
  - "**Consumer groups are independent** — one write, many readers, each with its own offsets"
  - "**Replay** — retained records mean a new consumer can read last week, and a fixed bug can reprocess a range"
  - "**At-least-once by default** — a crash between handling and committing replays the record, so consumers are idempotent"
  - "**Exactly-once holds only inside Kafka**; the moment you write elsewhere, you need an upsert or a dedup key"
  - "**Consumer lag is the health metric** — the distance between the head and your offset, and the first thing to alert on"
  - "**Log compaction** keeps the latest record per key, turning a topic into a changelog you can rebuild state from"
  - "**Buffering is the point** — a fast producer and a slow consumer build lag instead of failing"
---

# Kafka

## Use cases

### One write, several independent readers

The property that separates a log from a queue. Notifications, analytics and a
search indexer each read the same partitions at their own pace with their own
offsets, and adding a fourth consumer later costs the producer nothing.

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

### Publishing database changes without a dual write

An event written to Kafka by the application *after* the database commit can be
lost; one written *before* can describe a transaction that rolled back. The
outbox row is written in the same transaction as the data, and a relay publishes
it afterwards, so the two can never disagree.

```erd
# Outbox · the same transaction as the data
orders || the business write
+ order_id || bigint || PK
+ state || text
outbox || inserted in the same transaction; the relay deletes it after publishing
+ id || bigint || PK
+ aggregate_id || bigint || → orders
+ event_type || text
+ payload || jsonb
+ published || boolean
```

```mermaid
flowchart TB
    App([Service]) -- "BEGIN · insert order + outbox row · COMMIT" --> PG[("Postgres")]
    PG --> Relay["Relay<br/>reads unpublished rows, or CDC"]
    Relay -- "publish, then mark published" --> K{{"Kafka"}}
    K --> C1["Search indexer"]
    K --> C2["Email sender"]
    Relay -. "crash after publish, before mark<br/>→ duplicate, consumers are idempotent" .-> K

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class PG db
    class K queue
    class Relay hot
```

### Absorbing a spike the downstream cannot take

A producer writing 50k events/s into a consumer that handles 10k/s does not fail:
lag grows and drains later. That decoupling of write rate from processing rate is
the structural reason to put a log between two services.

```mermaid
flowchart TB
    Spike([Ad clicks · 50k/s peak]) --> K{{"Kafka<br/>retention 7 days"}}
    K --> C["Consumer · 10k/s steady"]
    C --> DB[("Warehouse")]
    K -. "lag grows during the spike<br/>and drains after it" .-> Lag["Consumer lag<br/>the metric to alert on"]
    Lag -. "still rising after the spike?<br/>add consumers, up to the partition count" .-> C

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class DB db
    class K queue
    class Lag hot
```

### Retries and a dead letter topic

A record that always fails blocks its partition, and everything behind it stops.
Retry with backoff a bounded number of times, then move it aside and keep going —
and alert on the dead letter topic, because it is where silent data loss hides.

```mermaid
flowchart TB
    P0["Partition 0"] --> C["Consumer"]
    C -- "ok · commit offset" --> P0
    C -. "fails" .-> Retry["Retry with backoff<br/>bounded attempts"]
    Retry -. "still failing" .-> DLQ{{"Dead letter topic"}}
    DLQ --> Alert["Alert · someone looks at it"]
    Retry -- "succeeds" --> C
    C -. "without this, the partition<br/>stops at the poison record" .-> P0

    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class DLQ queue
    class Retry hot
```
