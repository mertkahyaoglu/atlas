---
group: "tech"
order: 15
title: "ZooKeeper"
role: "Coordination service"
summary: "A small, strongly consistent store for the decisions a cluster must agree on: who leads, who is alive, who owns what."
tags: ["zookeeper", "consistency", "reliability", "concurrency", "sharding"]
---

# ZooKeeper

## Basics

ZooKeeper is not a database. It is a replicated, strongly consistent store for
tiny amounts of metadata that a distributed system must agree on: which node is
the leader, which nodes are alive, which worker owns which partition.

Data lives in a filesystem-like tree of **znodes**, each holding at most a megabyte
and usually far less. An ensemble of typically three or five servers runs the
**ZAB** protocol: all writes go through a leader and are committed once a majority
have them, so writes are linearizable and survive the loss of a minority. Reads
can be served by any member and may be slightly stale unless you `sync` first.

Two primitives do most of the work. **Ephemeral znodes** exist only while the
client's session is alive — the client heartbeats, and if it stops, the node
vanishes, which is failure detection with no extra machinery. **Sequential znodes**
get a monotonically increasing suffix on creation, which gives a total order.
**Watches** let a client be notified once when a znode changes, instead of polling.

The modern alternatives are **etcd** (Raft, the store behind Kubernetes) and
**Consul**. They are interchangeable for interview purposes; say "ZooKeeper or
etcd" and pick one.

## Key concepts and capabilities

**Leader election.** Every candidate creates an ephemeral sequential node under
`/election`. The lowest sequence number is the leader; each other candidate watches
only the node directly below it, so a failure wakes exactly one client instead of
a herd. If the leader dies, its ephemeral node disappears and the next in line is
promoted. This is the canonical recipe and it is worth being able to sketch.

**Membership and discovery.** Each worker registers an ephemeral node under
`/workers` with its address. A coordinator watches the directory, so joins and
failures arrive as events rather than as a polled health check.

**Partition assignment.** The elected coordinator writes the shard-to-worker map
into a znode; workers watch it and pick up their assignments. This is how Kafka
(before KRaft), HBase and Druid distribute work, and it is a good pattern to
borrow when a design needs "exactly one process handling each shard".

**Locks, with fencing.** A lock is an ephemeral sequential node plus a watch on the
predecessor. Critically, the sequence number is a **fencing token**: the holder
passes it to any resource it writes, and the resource rejects anything with a token
lower than the highest it has seen. That is what makes the lock safe when a process
pauses for a long GC and wakes up believing it still holds it — and it is the
property a Redis lock does not give you.

**Configuration that must be consistent.** Feature flags, cluster topology,
schema versions. Everyone watches the same znode and converges.

## When to use it in an interview

Reach for coordination when a design contains the phrase **"exactly one"**: one
scheduler running the cron, one writer per shard, one coordinator assigning work,
one active node in an active-passive pair. Also for cluster membership with real
failure detection, and for locks whose failure would cost money.

Name it lightly. In most designs, one sentence is enough — "a ZooKeeper or etcd
ensemble holds the shard assignment and elects the coordinator" — and the rest of
your time is better spent on the data path. The times it deserves more are
designs about distributed schedulers, custom sharded stores, or anything where
you are explicitly building a cluster rather than using one.

Do not use it as a key-value store, a queue, or for anything high-volume. Every
write goes through one leader and is replicated synchronously; it is built for
thousands of writes per second of metadata, not your traffic. And if your only need
is "roughly one worker at a time", a lease row in Postgres with an expiry is
simpler and you should say so.

## What interviewers push on

- **Do you actually need it?** The best answer often starts by ruling it out: a database lease, a partitioned Kafka consumer group, or idempotent work that tolerates being done twice all avoid another system.
- **Split brain.** Explain how a majority quorum prevents two leaders, and that a partitioned minority cannot commit writes. Then the harder half: a leader that is merely slow may still think it leads, which is what fencing tokens are for.
- **Why is a Redis lock not equivalent?** No consensus, no fencing token, and replication is asynchronous, so a failover can lose the lock's existence. Fine for deduplicating work, not for protecting money.
- **What happens when a session expires wrongly?** A long GC pause or a network blip drops the ephemeral node and triggers a needless failover. Session timeouts are tuned against that, and the work must be safe to restart.
- **Capacity.** Small data, a few thousand writes per second, one leader. If a design puts per-request state in it, that is the mistake being probed.
- **Kafka and KRaft.** Kafka used ZooKeeper for metadata and now runs its own Raft quorum instead. Knowing that is a cheap signal that your knowledge is current.
