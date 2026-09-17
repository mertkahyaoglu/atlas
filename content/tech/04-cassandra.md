---
group: "tech"
order: 4
title: "Cassandra"
role: "Wide-column store"
summary: "Masterless, write-optimised storage that scales linearly — as long as every query is known in advance."
tags: ["cassandra", "sharding", "replication", "consistency", "consistent-hashing"]
---

# Cassandra

## Basics

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

Consistency is a per-query dial. With replication factor `N`, you choose how many
replicas must answer a read (`R`) and a write (`W`). When `R + W > N`, the two sets
overlap and a read is guaranteed to see the latest acknowledged write. `QUORUM`
for both is the usual pick; `ONE` buys latency and gives up freshness.

## Key concepts and capabilities

**The data model is the query plan.** The primary key is a **partition key** plus
optional **clustering columns**. The partition key decides which node holds the
row; the clustering columns decide the sort order *within* that partition. You
cannot filter efficiently on anything else, and there are no joins. So you design
backwards from the queries, and you duplicate data into a second table rather than
adding an index — writes are cheap, that is the entire bargain.

A messages table is the canonical shape:

```
PRIMARY KEY ((channel_id, day_bucket), created_at, message_id)
```

`channel_id` picks the node. `day_bucket` keeps one busy channel from growing an
unbounded partition. `created_at` descending makes "the last 50 messages" a
contiguous disk read.

**Tombstones.** A delete writes a marker, not a removal; the data disappears only
after compaction and a grace period. Read a range full of tombstones and the query
gets slower the more you have deleted. This is why Cassandra is a bad queue.

**Compaction strategy matters.** Size-tiered is the default and fine for
write-heavy tables. Leveled makes reads predictable at the cost of write
amplification. Time-window is what you want for time series with a TTL, because a
whole SSTable of expired data can be dropped at once.

**Repair keeps replicas honest.** Hinted handoff stores writes for a briefly dead
node; read repair fixes divergence it notices; anti-entropy repair must be run on
a schedule. Conflicts are resolved by last-write-wins on timestamps, so concurrent
updates to the same cell silently drop one.

**Multi-datacenter replication is first-class.** Replicas can be placed per region
with a local quorum, which is how a design gets low-latency writes on two
continents without a global leader.

## When to use it in an interview

Cassandra is the right answer for **append-heavy data with a known access
pattern**: chat messages, activity feeds, notification history, time series and
sensor readings, audit logs. It is also the answer when the requirement says
"always writable, multiple regions" and the data can tolerate eventual
consistency.

In feed and chat designs it typically sits beside Postgres, not instead of it:
Postgres holds users, channels and memberships — the small relational data with
invariants — while Cassandra holds the enormous append-only body of messages.
Saying that split out loud is what a strong answer sounds like.

Do not choose it for data you will query in ways you have not anticipated, for
anything needing a transaction across rows, or for small datasets where a
partitioned Postgres table would do. DynamoDB is the same shape of store without
the operations, so if the design is AWS-flavoured, say that too.

## What interviewers push on

- **What is the partition key, and is it hot?** A key like `country` puts a continent on one node. Pick something high-cardinality, and bucket by time if a single partition can grow forever.
- **Unbounded partitions.** "What if one channel has 50 million messages?" The answer is a composite partition key with a time bucket, and a client that walks buckets backwards.
- **R + W > N.** Be able to work the arithmetic live: N=3, W=QUORUM(2), R=QUORUM(2) gives consistent reads and survives one node; R=1 is faster and may be stale.
- **Concurrent updates.** Last-write-wins means a lost update, and clock skew decides the winner. If you need compare-and-set, lightweight transactions use Paxos per partition and are slow enough that you should design around them.
- **Deletes and queues.** Anyone proposing Cassandra as a work queue gets asked about tombstones. Use Kafka or a real queue.
- **Secondary indexes.** They query every node. Build a second table instead, and say that you are trading storage for query speed deliberately.
