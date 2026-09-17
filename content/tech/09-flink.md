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
concepts:
  - "**Event time, not processing time** — count an event in the minute it happened, not the minute it arrived"
  - "**Watermarks** assert that nothing older is still expected, and are what make a window fire"
  - "**Late data** can be dropped, given a grace period, or routed to a side output for reconciliation"
  - "**Windows** — tumbling (per minute), sliding (last 5 minutes, every minute) and session (gaps of inactivity)"
  - "**Keyed state** — a running count or session per key, held in RocksDB on local disk, checkpointed to durable storage"
  - "**Checkpoints** snapshot every operator plus the source offsets, so recovery rewinds and replays"
  - "**Savepoints** are the manual version: stop, change parallelism or code, restore"
  - "**Exactly-once needs a cooperating sink** — transactional two-phase commit, or an idempotent write"
  - "**Backpressure propagates** — a slow sink slows the source and grows Kafka lag instead of dropping data"
---

# Flink

## Use cases

### Clicks per campaign per minute, counted honestly

The canonical job. Events are keyed by campaign, windowed on **event time**, and
the window fires when the watermark passes its end — so a phone that was offline
for ten minutes still lands in the minute it clicked, not the minute it
reconnected.

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

### Attributing a click to its impression

A stream-to-stream join over a time window: hold impressions in keyed state for
30 minutes, and when a click arrives for the same ad and user, emit the pair.
State that expires is why this is a stream processor's job and not a database
query.

```mermaid
flowchart TB
    I{{"impressions"}} --> KeyI["keyBy(ad_id, user_id)"]
    C{{"clicks"}} --> KeyC["keyBy(ad_id, user_id)"]
    KeyI --> Join["Interval join<br/>click within 30 min of impression"]
    KeyC --> Join
    Join --> Attr[("Attributed conversions")]
    Join -. "no impression in state<br/>→ unattributed" .-> Unattr[("Unattributed bucket")]
    Join -. "state expires after the window<br/>so it stays bounded" .-> Join

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Attr,Unattr db
    class I,C queue
    class Join hot
```

### Turning raw events into sessions

A session window groups a user's events until they go quiet for N minutes, which
is how a raw click stream becomes "a browsing session" — the unit product
analytics actually wants, and one that no fixed window can express.

```mermaid
flowchart TB
    E{{"page views"}} --> K["keyBy(user_id)"]
    K --> S["Session window<br/>gap = 30 min of inactivity"]
    S --> Out["One row per session<br/>start, end, pages, duration"]
    Out --> Store[("Analytics store")]
    S -. "a late event can merge<br/>two sessions into one" .-> S

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Store db
    class E queue
    class S hot
```

### Surviving a crash, and a traffic doubling

Checkpoints are what make a stateful job restartable: a barrier flows through the
graph and snapshots every operator's state with the offsets that produced it, so
recovery is "restore and rewind". The same mechanism, triggered by hand, is how
you rescale.

```mermaid
flowchart TB
    Src["Source<br/>offset 41 920"] -- "barrier" --> Op1["keyBy → window"]
    Op1 -- "barrier" --> Op2["Aggregate<br/>state snapshot"]
    Op2 --> CP[("Checkpoint<br/>durable storage")]
    Crash(["Task manager dies"]) -. "restore state<br/>rewind the source" .-> CP
    CP --> Restart["Job resumes as if nothing happened"]
    Save["Savepoint · on purpose"] --> Rescale["Change parallelism or code, restore"]

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class CP db
    class Op2 hot
```
