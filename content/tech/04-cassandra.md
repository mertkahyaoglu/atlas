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
capabilities:
  - title: "The data model is the query plan"
    body: |-
      The partition key decides which node holds the row; the clustering columns decide the sort order *within* that partition. You cannot filter efficiently on anything else.

      So you design backwards from the queries, and duplicate data into a second table rather than adding an index — writes are cheap, and that is the entire bargain.
  - title: "Tombstones"
    body: |-
      A delete writes a marker, not a removal; the data disappears only after compaction and a grace period.

      Read a range full of tombstones and the query gets slower the more you have deleted. This is why Cassandra is a bad queue.
  - title: "Compaction strategy matters"
    body: |-
      Size-tiered is the default and fine for write-heavy tables. Leveled makes reads predictable at the cost of write amplification.

      Time-window is what you want for time series with a TTL, because a whole SSTable of expired data can be dropped at once.
  - title: "Repair keeps replicas honest"
    body: |-
      Hinted handoff stores writes for a briefly dead node; read repair fixes divergence it notices; anti-entropy repair must be run on a schedule.

      Conflicts resolve by last-write-wins on timestamps, so two concurrent updates to the same cell silently drop one.
  - title: "Multi-datacenter replication is first-class"
    body: |-
      Replicas can be placed per region with a local quorum, which is how a design gets low-latency writes on two continents without a global leader.
useWhen:
  - "Append-heavy data with a known access pattern: chat messages, activity feeds, notification history, time series, audit logs"
  - "The requirement says \"always writable, in several regions\" and the data tolerates eventual consistency"
  - "Beside Postgres, not instead of it: small relational data with invariants there, the enormous append-only body here"
avoidWhen:
  - "You will query the data in ways you have not anticipated"
  - "You need a transaction across rows — lightweight transactions exist, and are slow enough to design around"
  - "The dataset is small enough that a partitioned Postgres table would do"
  - "The design is AWS-flavoured: DynamoDB is the same shape without the operations"
probes:
  - question: "What is the partition key, and is it hot?"
    answer: "A key like `country` puts a continent on one node. Pick something high-cardinality, and bucket by time if a single partition can grow forever."
  - question: "What if one channel has 50 million messages?"
    answer: "Unbounded partition. Use a composite partition key with a time bucket, and a client that walks buckets backwards."
  - question: "Work R + W > N live."
    answer: "N=3 with W=QUORUM(2) and R=QUORUM(2) gives consistent reads and survives one node down. R=1 is faster and may be stale."
  - question: "Two writers update the same cell at once."
    answer: "Last-write-wins means a lost update, and clock skew decides the winner. If you need compare-and-set, lightweight transactions use Paxos per partition — and are slow."
  - question: "Can I use it as a work queue?"
    answer: "No. Queue workloads delete constantly, and tombstones make the range reads slower the more you have deleted. Use Kafka or a real queue."
  - question: "Why not a secondary index?"
    answer: "It queries every node. Build a second table instead, and say you are trading storage for query speed deliberately."
---

# Cassandra

## How it works

Cassandra is a wide-column store built for one thing: absorbing enormous write
volume across many nodes with no single point of failure.

Every node is equal. Keys are placed on a ring by **consistent hashing** — each
node owns many small token ranges (vnodes), so adding a node takes a slice from
everyone rather than re-splitting one neighbour. Any node can serve any request by
forwarding it to the replicas that own the key. Nodes learn about each other by
gossip; there is no leader to elect and nothing to fail over.

Writes are fast because of the **LSM tree**. A write goes to a commit log and an
in-memory memtable and is immediately acknowledged. Memtables are flushed to
immutable SSTables on disk, and background compaction merges them. Nothing is
updated in place, so there are no random disk writes and no read-before-write.

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

Consistency is a per-query dial. With replication factor `N`, you choose how many
replicas must answer a read (`R`) and a write (`W`). When `R + W > N`, the two sets
overlap and a read is guaranteed to see the latest acknowledged write. `QUORUM`
for both is the usual pick; `ONE` buys latency and gives up freshness.

## The table you will be asked to design

A messages table is the canonical shape: `PRIMARY KEY ((channel_id, day_bucket),
created_at, message_id)`.

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

`channel_id` picks the node. `day_bucket` keeps one busy channel from growing an
unbounded partition. `created_at` descending makes "the last 50 messages" a
contiguous disk read. The second table is not an index — it is the same data
written twice, on purpose.

## Where it fits in a design

In feed and chat designs Cassandra typically sits beside Postgres, not instead of
it: Postgres holds users, channels and memberships — the small relational data
with invariants — while Cassandra holds the enormous append-only body of
messages.

> Saying that split out loud, with the reason for each half, is what a strong
> answer sounds like.
