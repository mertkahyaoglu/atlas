#!/usr/bin/env python3
"""Inject frontmatter into the content markdown.

Run after adding or replacing a file in content/. Idempotent: a file that
already has frontmatter is rewritten, not doubled up.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

CONCEPTS = {
    "01-foundations": dict(
        order=1,
        title="Foundations",
        summary="Latency versus throughput, percentiles and tail amplification, scaling directions, load balancing, and estimation that ends in a decision.",
        tags=["estimation", "reliability", "sharding"],
    ),
    "02-data-storage": dict(
        order=2,
        title="Data Storage",
        summary="Picking a database from access patterns, how indexes really cost you, replication lag, sharding strategies, and consistent hashing.",
        tags=["sharding", "replication", "consistent-hashing", "postgres", "cassandra"],
    ),
    "03-consistency-and-distributed-systems": dict(
        order=3,
        title="Consistency and Distributed Systems",
        summary="CAP stated correctly, PACELC, the consistency spectrum, quorums, Raft, idempotency, sagas, and the outbox pattern.",
        tags=["consistency", "idempotency", "saga", "outbox", "replication"],
    ),
    "04-caching": dict(
        order=4,
        title="Caching",
        summary="Cache patterns and eviction, why hit rate dominates latency, invalidation, and the three named failure modes with fixes for each.",
        tags=["caching", "redis", "cdn"],
    ),
    "05-async-messaging-and-event-driven": dict(
        order=5,
        title="Async Messaging and Event-Driven Architecture",
        summary="Queues versus pub/sub, Kafka partitions and consumer groups, delivery semantics, retries with jitter, dead letter queues, CQRS and event sourcing.",
        tags=["event-driven", "kafka", "cqrs", "idempotency"],
    ),
    "06-fanout-and-feeds": dict(
        order=6,
        title="Fan-out, Feeds and Timelines",
        summary="Push versus pull, the read/write cost asymmetry, the celebrity problem, and the hybrid that resolves it. The most reused pattern in the field.",
        tags=["fanout", "caching", "cassandra"],
    ),
    "07-apis-and-communication": dict(
        order=7,
        title="APIs and Real-Time Communication",
        summary="REST, gRPC and GraphQL compared; polling through WebSockets; cursor pagination; API gateways; and four rate limiting algorithms.",
        tags=["realtime", "websockets", "pagination", "rate-limiting", "grpc"],
    ),
    "08-reliability-and-operations": dict(
        order=8,
        title="Reliability and Operations",
        summary="Error budgets, failover and split-brain, timeouts and circuit breakers, graceful degradation, observability, and safe schema migration.",
        tags=["reliability", "circuit-breaker", "observability"],
    ),
    "09-specialized-building-blocks": dict(
        order=9,
        title="Specialized Building Blocks",
        summary="Inverted indexes, object storage, batch versus stream processing, Bloom filters, Snowflake IDs, and geospatial indexing.",
        tags=["search", "bloom-filter", "stream-processing", "geospatial", "object-storage"],
    ),
    "10-interview-playbook": dict(
        order=10,
        title="The Interview Playbook",
        summary="The 45-minute framework with a time budget, prompts mapped to concepts, sentences that score, what loses points, and the rubric you're graded against.",
        tags=["estimation"],
    ),
}

DESIGNS = {
    "01-twitter-instagram-feed": dict(
        order=1,
        title="Twitter / Instagram Feed",
        summary="A home timeline serving 150k reads per second, where one post can reach a hundred million followers.",
        hardPart="The celebrity problem. A design that only works for the median user fails — fan-out cost is bimodal and the code path has to split.",
        tags=["fanout", "caching", "cassandra", "pagination"],
    ),
    "02-chat-slack": dict(
        order=2,
        title="Chat / Slack",
        summary="Fifty million concurrent sockets, ordered message delivery, and users who go offline mid-conversation.",
        hardPart="You have fifty stateful gateway nodes and a message for Alice. How does the sender find the node holding her socket, and what happens when she's offline?",
        tags=["realtime", "websockets", "cassandra", "idempotency"],
    ),
    "03-url-shortener": dict(
        order=3,
        title="URL Shortener",
        summary="A hundred million links a day and a hundred to one read skew. The classic estimation warm-up.",
        hardPart="Generating short, unique, non-guessable keys without a central bottleneck — and recognising this is a cache problem, not a database problem.",
        tags=["estimation", "caching", "redis", "sharding"],
    ),
    "04-rate-limiter": dict(
        order=4,
        title="Distributed Rate Limiter",
        summary="One global limit enforced across a fleet of stateless API servers, at a million requests per second.",
        hardPart="Enforcing a global limit without a synchronous Redis round trip on every request — and deciding what happens when the limiter's own store is down.",
        tags=["rate-limiting", "redis", "concurrency", "reliability"],
    ),
    "05-notification-system": dict(
        order=5,
        title="Notification System",
        summary="Events from many producers, matched to recipients, delivered in-app, by email and by push, without losing any.",
        hardPart="Third-party delivery channels fail constantly and are rate limited. Nothing may be lost, nothing visibly duplicated, and one flaky provider must not take down the rest.",
        tags=["event-driven", "kafka", "fanout", "idempotency", "circuit-breaker"],
    ),
    "06-search-typeahead": dict(
        order=6,
        title="Search and Typeahead",
        summary="A billion documents, a hundred thousand queries a second, and autocomplete firing on every keystroke.",
        hardPart="Search is a scatter-gather, so your latency is your slowest shard. And the index is not the source of truth — you have to explain how it stays in sync and that it lags.",
        tags=["search", "elasticsearch", "sharding", "caching"],
    ),
    "07-uber-delivery-tracking": dict(
        order=7,
        title="Uber / Delivery Tracking",
        summary="Five million drivers publishing position every four seconds, matched to riders in real time.",
        hardPart="Two problems glued together: 1.25M location writes per second that destroy any disk-backed index, and a matching step where two riders must never get the same driver.",
        tags=["geospatial", "redis", "concurrency", "realtime", "saga"],
    ),
    "08-video-streaming": dict(
        order=8,
        title="Video Streaming",
        summary="Upload, transcode and deliver video at twenty-five terabits per second of egress.",
        hardPart="Video bytes never touch your application servers — not on upload, not on playback. What you actually build is a metadata service and a transcoding pipeline.",
        tags=["object-storage", "cdn", "chunking", "stream-processing"],
    ),
    "09-web-crawler": dict(
        order=9,
        title="Web Crawler",
        summary="Ten billion pages, ten thousand fetches a second, without hammering any single domain.",
        hardPart="Politeness. Crawling fast is easy; crawling fast without overloading one host forces a queue design grouped by host rather than FIFO. Then dedupe at a scale where you can't store what you've seen.",
        tags=["bloom-filter", "dedup", "consistent-hashing", "rate-limiting"],
    ),
    "10-payment-system": dict(
        order=10,
        title="Payment System",
        summary="Charges, captures, refunds and payouts across an unreliable external processor, with a ledger that has to balance.",
        hardPart="The one design where consistency beats availability, and where at-least-once plus idempotent stops being a slogan and becomes the mechanism preventing double charges.",
        tags=["consistency", "idempotency", "saga", "outbox", "postgres"],
    ),
    "11-ticketmaster-booking": dict(
        order=11,
        title="Ticketmaster / Booking",
        summary="Fifty thousand people wanting the same hundred seats in the same second.",
        hardPart="This is contention, not scale. Row lock contention breaks first, not throughput — so the answer is admission control in front of the application tier, not a bigger cluster.",
        tags=["concurrency", "consistency", "postgres", "saga"],
    ),
    "12-dropbox-file-sync": dict(
        order=12,
        title="Dropbox / File Sync",
        summary="Syncing files across devices without re-uploading a two gigabyte file because one paragraph changed.",
        hardPart="Bandwidth efficiency through content-defined chunking and delta sync — plus a coherent story for two clients that edited the same file offline.",
        tags=["chunking", "dedup", "object-storage", "consistency"],
    ),
    "13-ad-click-aggregation": dict(
        order=13,
        title="Ad Click Aggregation",
        summary="A million events a second aggregated into dashboards that are fast and billing numbers that are exact.",
        hardPart="Event time. Clicks arrive late, out of order and duplicated. Aggregating by arrival time is easy and wrong, and advertisers are billed from these numbers.",
        tags=["stream-processing", "flink", "olap", "kafka", "dedup"],
    ),
    "14-distributed-cache": dict(
        order=14,
        title="Distributed Cache",
        summary="Building Redis: a hundred nodes holding a terabyte of hot data with sub-millisecond reads.",
        hardPart="Rebalancing. Naive modulo hashing invalidates eighty percent of the cache when you add a node and stampedes the origin. And consistent hashing does not solve hot keys.",
        tags=["consistent-hashing", "caching", "redis", "replication"],
    ),
    "15-google-docs-collaborative-editing": dict(
        order=15,
        title="Google Docs",
        summary="Many people typing into one document at once, with no perceptible lag and no lost edits.",
        hardPart="Convergence. Two users edit the same sentence with no coordination. Both must end up with an identical document and neither edit may be silently lost — so last-write-wins is catastrophically wrong.",
        tags=["crdt", "consistency", "websockets", "realtime"],
    ),
}


def yaml_value(value):
    if isinstance(value, int):
        return str(value)
    if isinstance(value, list):
        return "[" + ", ".join(f'"{v}"' for v in value) + "]"
    return '"' + str(value).replace('"', '\\"') + '"'


def write(path: pathlib.Path, meta: dict, group: str):
    text = path.read_text(encoding="utf8")
    # Drop any existing frontmatter so re-runs stay clean.
    text = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.DOTALL)

    lines = ["---", f'group: "{group}"']
    for key in ("order", "title", "summary", "hardPart", "tags"):
        if key in meta:
            lines.append(f"{key}: {yaml_value(meta[key])}")
    lines.append("---")

    path.write_text("\n".join(lines) + "\n\n" + text.lstrip(), encoding="utf8")


def main():
    for slug, meta in CONCEPTS.items():
        write(CONTENT / "concepts" / f"{slug}.md", meta, "concept")
    for slug, meta in DESIGNS.items():
        write(CONTENT / "designs" / f"{slug}.md", meta, "design")
    print(f"frontmatter written: {len(CONCEPTS)} concepts, {len(DESIGNS)} designs")


if __name__ == "__main__":
    main()
