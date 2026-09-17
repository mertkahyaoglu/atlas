---
group: "tech"
order: 4
title: "Cassandra"
role: "Wide-column store"
summary: "Masterless, write-optimised storage that scales linearly — as long as every query is known in advance."
tags: ["cassandra", "sharding", "replication", "consistency", "consistent-hashing"]
facts:
  - label: "Model"
    value: "Partition key + clustering columns; no joins, no ad-hoc filters"
  - label: "Topology"
    value: "Masterless ring, vnodes, gossip — nothing to fail over"
  - label: "Writes"
    value: "LSM tree: commit log + memtable, acked before any disk seek"
  - label: "Consistency"
    value: "Per query: `R + W > N` gives you a fresh read"
  - label: "Conflicts"
    value: "Last-write-wins on timestamps; concurrent updates drop one"
  - label: "Geography"
    value: "Multi-datacenter replication with a local quorum"
concepts:
  - "**The data model is the query plan** — the partition key picks the node, clustering columns set the order inside it"
  - "**Duplicate, don't index** — a second table per query, written at the same time, because writes are the cheap part"
  - "**LSM writes** — commit log plus memtable, acked before any disk seek; SSTables are immutable and compacted later"
  - "**`R + W > N`** — the dial per query; QUORUM both ways is the usual pick, `ONE` buys latency and gives up freshness"
  - "**Tombstones** — a delete is a marker, so heavy deletion makes range reads slower; this is why it is a bad queue"
  - "**Compaction strategy** — size-tiered for write-heavy, leveled for predictable reads, time-window for TTL'd time series"
  - "**Repair** — hinted handoff, read repair and scheduled anti-entropy keep replicas honest"
  - "**Last-write-wins** — concurrent updates to a cell silently drop one, and clock skew picks the winner"
  - "**Bucket unbounded partitions** — add a time component to the partition key before one channel grows forever"
---

# Cassandra

## Use cases

### Chat messages and feeds, keyed for the query

The canonical shape. `channel_id` picks the node, `day_bucket` stops one busy
channel growing an unbounded partition, and `created_at DESC` makes "the last 50
messages" one contiguous read. A second query means a second table holding the
same rows, written at the same time.

```erd
# Messages · Cassandra
messages_by_channel || one partition per channel per day; "the last 50" is one contiguous read || Cassandra
+ channel_id || uuid || PK
+ day_bucket || date || PK
+ created_at || timestamp || SK DESC
+ message_id || timeuuid || SK
+ sender_id || uuid
+ body || text
# The same rows, keyed for a second query
messages_by_sender || duplicated on write, because writes are the cheap part || Cassandra
+ sender_id || uuid || PK
+ created_at || timestamp || SK DESC
+ channel_id || uuid || → messages_by_channel
+ message_id || timeuuid
```

### Absorbing a firehose of writes

Every node accepts every request, and a write is durable after a sequential
append plus a memory write — no read-before-write and no random disk IO. That is
why the answer to "two million writes a second, append-only" is this shape rather
than a bigger primary.

```mermaid
flowchart TB
    Client([Any client]) -- "write, CL=QUORUM" --> Coord["Coordinator<br/>any node will do"]
    Coord -- "replicate to N=3" --> R1["Replica A"]
    Coord --> R2["Replica B"]
    Coord -. "hinted handoff<br/>while it is down" .-> R3["Replica C"]

    subgraph LSM ["On each replica"]
        direction TB
        Log["1 · commit log<br/>append, then ack"]
        Mem["2 · memtable<br/>in memory, sorted"]
        SST[("3 · SSTables<br/>immutable · compacted")]
        Log --> Mem --> SST
    end

    R1 --> Log

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class SST db
    class Log hot
```

### Choosing freshness per query

Consistency is a dial you set per statement, not a property of the cluster. Work
the arithmetic out loud: with N=3, QUORUM writes and QUORUM reads overlap on at
least one replica, so a read sees the latest acknowledged write and one node can
be down. `ONE` is faster and may be stale — fine for a view counter, not for a
balance.

```mermaid
flowchart TB
    W([Write · W=QUORUM]) --> A1["Replica A ✓"]
    W --> A2["Replica B ✓"]
    W -. "lags or is down" .-> A3["Replica C"]
    R([Read · R=QUORUM]) --> A2
    R --> A3
    A2 -- "R + W > N → the sets overlap<br/>so the read sees the write" --> R
    A3 -. "read repair fixes it in the background" .-> A3

    classDef hot stroke:#e8a33d,stroke-width:2px
    class A2 hot
```

### Writing in two regions without a leader

Replicas are placed per datacenter, and each side commits on a **local quorum**,
so a write in Frankfurt does not wait for Virginia. Cross-region replication is
asynchronous, and conflicts resolve last-write-wins — which is exactly why this
suits feeds and messages, and not balances.

```mermaid
flowchart TB
    EU([Writer · Frankfurt]) --> DC1["EU datacenter<br/>LOCAL_QUORUM"]
    US([Writer · Virginia]) --> DC2["US datacenter<br/>LOCAL_QUORUM"]
    DC1 -. "async replication<br/>last-write-wins on conflict" .-> DC2
    DC2 -. "and back" .-> DC1
    DC1 --> R1[("3 replicas")]
    DC2 --> R2[("3 replicas")]

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class R1,R2 db
    class DC1 hot
```
