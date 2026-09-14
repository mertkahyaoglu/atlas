---
group: "design"
order: 1
title: "Twitter / Instagram Feed"
summary: "A home timeline serving 150k reads per second, where one post can reach a hundred million followers."
hardPart: "The celebrity problem. A design that only works for the median user fails — fan-out cost is bimodal and the code path has to split."
tags: ["fanout", "caching", "cassandra", "pagination"]
hardPartDetail: "The celebrity problem. A design that only works for the median user is a fail. They want to see you recognize that fan-out cost is bimodal and split the code path."
concepts:
  - "fan-out on write vs read"
  - "hybrid fan-out"
  - "wide-column storage"
  - "caching"
  - "denormalization"
  - "cursor pagination"
  - "read:write skew"
requirements:
  functional:
    - "Post a tweet/photo (text + optional media)"
    - "Follow / unfollow a user"
    - "View home timeline (posts from people you follow, reverse-chronological)"
    - "View a user's own profile timeline"
  nonFunctional:
    - "Read-heavy: assume ~100:1 read:write"
    - "Home timeline load p99 < 200ms"
    - "Availability over consistency — a 5-second-stale timeline is fine, a failed load is not"
    - "Eventually consistent; posts appear within a few seconds"
  outOfScope: "DMs, search, ML ranking, ads, notifications."
scale:
  numbers: |-
    300M DAU · 
    Posts:    50M/day    → ~500/sec  (peak 3x = 1,500/sec)
    Timeline reads:              → ~150,000/sec
    Avg followers:  ~200         → fan-out multiplier 200
    Celebrity max:  100M followers
    Post row: ~300B → 50M × 300B = 15 GB/day of posts
    Feed rows: 50M × 200 = 10B rows/day of references (~50B each = 500 GB/day)
  conclusion: "10B feed writes/day is the whole problem. That number is what forces the hybrid."
tradeoffs:
  - title: "Why fan-out on write is the base case"
    body: |-
      Reads outnumber writes 100:1. Precomputing moves work from the frequent operation to the rare one. Read becomes a single-partition sequential scan on a sorted key: ~1ms.
  - title: "Why it can't be the only case"
    body: |-
      100M followers × even a few posts/day saturates the write path and arrives as a spike. There is no amount of horizontal scaling that makes 100M synchronous writes a good idea for one post.
  - title: "Why the hybrid works"
    body: |-
      The costs are inversely distributed. A user follows *many* ordinary accounts (so precomputation pays off) but only a *few* celebrities (so read-time merge is cheap). You pick the cheap side of each. And a celebrity's recent-posts list is one cache entry serving 100M readers — the highest leverage cache in the system.
  - title: "Threshold T is a tunable, not a constant"
    body: |-
      Set it empirically where fan-out cost exceeds merge cost. Expect it to differ by product.
  - title: "Active-user optimization"
    body: |-
      Only fan out to users active in the last ~30 days. Most registered accounts are dormant; this can eliminate the majority of feed writes. Dormant users get a full read-time rebuild when they return.
  - title: "Deletes"
    body: |-
      Don't fan out deletions — that's another N writes. Filter at read time by checking a tombstone set, or by verifying the post still exists during hydration. Trade a slightly more expensive read for avoiding a huge delete fan-out.
  - title: "Feed length cap"
    body: |-
      Keep ~800-1,000 refs per user. Nobody scrolls further; without a cap storage grows unbounded.
  - title: "Idempotent fan-out"
    body: |-
      Kafka is at-least-once, so the same post may be fanned out twice. `PK=(user_id, post_id)` makes a duplicate write a harmless overwrite.
  - title: "Pagination"
    body: |-
      Cursor-based on `post_id` (Snowflake IDs are time-sortable, so the ID *is* the cursor). Offset pagination would break as new posts shift positions.
  - title: "Late follow"
    body: |-
      If Bob follows Alice after she posted, her post isn't in his feed. Either backfill her recent posts into his timeline on follow, or accept it and let it resolve going forward. Backfill-on-follow is the better UX and is a bounded, small job.
followUps:
  - question: "A celebrity's follower count crosses the threshold mid-life. What happens?"
    answer: "Their old posts were fanned out, new ones aren't. You need both paths to coexist; the merge handles it naturally since duplicates dedupe by post_id."
  - question: "How do you add ML ranking?"
    answer: "The feed store becomes a *candidate* set. Ranking happens at read time: generate candidates → filter seen/blocked → score with a cheap model → rescore top few hundred with an expensive model → apply diversity rules. Features precomputed and cached."
  - question: "How do you handle a user who follows 50,000 accounts?"
    answer: "Fan-out on write is unaffected (it's the author's follower count that matters, not the reader's following count). The read-time celebrity merge is what grows — cap the number of celebrity lists you merge."
  - question: "Retweets/reposts?"
    answer: "Store as a post referencing the original. Fan out the repost; hydrate the original at read time. Dedupe if multiple people you follow repost the same thing."
  - question: "How do you keep the timeline cache warm?"
    answer: "Pre-warm on login/app-open signals, and use stale-while-revalidate so users never wait for a rebuild."
  - question: "What breaks first at 10x?"
    answer: "Fan-out worker throughput, then the `user_timeline` write volume. Mitigations: raise the celebrity threshold, tighten the active-user window, shard fan-out workers by author."
---
# 01 — Twitter / Instagram Feed

## API / Model

```api
POST /v1/posts || {text, media_ids} || 201 post_id
GET /v1/timeline/home?cursor=&limit=50 || || 200 home feed page
GET /v1/users/{id}/posts?cursor=&limit=50 || || 200 user's posts
POST /v1/users/{id}/follow || || 204
DEL /v1/users/{id}/follow || || 204
```

```schema
posts || PK: post_id || author_id, text, media_urls, created_at, reply_to || post_id is a Snowflake, so it is time-sortable
social_graph || PK: follower_id SK: followee_id || || who I follow
social_graph (reverse) || PK: followee_id SK: follower_id || || who follows me; a second, denormalized table for fan-out lookup
user_timeline || PK: user_id SK: post_id DESC || post_id, author_id || the precomputed feed; references only, not the post body
users || PK: user_id || name, follower_count, is_celebrity || is_celebrity is a bool derived from follower_count
```

Two directions of the social graph are stored separately because fan-out needs "who follows X" while the UI needs "who does X follow". Same data, two access patterns, two tables. That's Module 2 in action.

---

## High-level architecture

```mermaid
flowchart TB
    Client([Mobile / Web client]) --> GW[API Gateway<br/>auth · rate limit]
    GW -- "POST /posts" --> PostSvc
    GW -- "GET /timeline" --> Timeline

    subgraph WRITE ["Write path"]
        direction TB
        PostSvc[Post Service]
        PostStore[(posts store<br/>Cassandra)]
        Bus{{"Kafka · post.created"}}
        PostSvc --> PostStore
        PostSvc --> Bus
    end

    subgraph FANOUT ["Fan-out service · consumer group"]
        direction TB
        Decide{"author follower count<br/>> 100k ?"}
        Eager["Fan out to followers<br/>batched idempotent writes<br/>PK = user_id + post_id"]
        Skip["Skip eager fan-out<br/>mark for read-time pull"]
        Decide -- "no · ordinary user" --> Eager
        Decide -- "yes · celebrity" --> Skip
    end
    Bus --> Decide
    Eager --> Feed[("user_timeline<br/>PK = user_id<br/>SK = post_id DESC")]
    Skip --> CelebCache[("Redis · celebrity cache<br/>one list serves 100M followers")]

    subgraph READ ["Read path"]
        direction TB
        Timeline[Timeline Service]
        TimelineCache[("Redis · assembled timeline<br/>TTL 30s")]
        Merge["Merge and sort by post_id<br/>filter deleted · paginate by cursor"]
        Timeline -- "cache miss" --> Merge
        Merge -- "store 30s" --> TimelineCache
    end
    Feed -- "precomputed rows" --> Merge
    CelebCache -- "celebrity posts" --> Merge
    TimelineCache -- "feed page" --> Resp([Response to client])
    Media[("Blob storage + CDN<br/>images and video")] -. "media URLs" .-> Resp

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class PostStore,Feed,CelebCache,TimelineCache,Media store
    class Decide hot

    click Bus href "/docs/05-async-messaging-and-event-driven" "Role: decouples posting from fan-out so the write returns immediately.<br/>Trade-off: followers see the post seconds later, and consumers must be idempotent."
    click Skip href "/docs/06-fanout-and-feeds" "Role: celebrity posts are not copied into millions of timelines.<br/>Trade-off: every read must merge those posts in, which moves work to read time."
    click CelebCache href "/docs/04-caching" "Role: one hot list per celebrity, shared by all of their followers at read time.<br/>Trade-off: extremely hot keys that need replication and careful invalidation."
    click TimelineCache href "/docs/04-caching" "Role: serves the fully merged home feed without recomputing it.<br/>Trade-off: up to 30s stale, so a brand-new post may not show immediately."
    click Media href "/docs/09-specialized-building-blocks" "Role: serves images and video from the edge, never through app servers.<br/>Trade-off: egress cost and slow invalidation, so deletes take time to disappear."
```

<details>
<summary>Plain-text version of this diagram</summary>

```text
                                      ┌──────────────┐
   [Mobile / Web]───────────────────► │   CDN        │  media (images, video)
          │                            └──────────────┘
          │ HTTPS                             ▲
          ▼                                   │
   ┌──────────────┐                    ┌──────────────┐
   │ API Gateway  │  authn, rate limit │ Blob Storage │  S3, presigned upload
   └──────┬───────┘                    └──────────────┘
          │                                   ▲
    ┌─────┴──────────────────────┐            │ direct upload
    ▼                            ▼            │
┌────────────┐            ┌────────────┐      │
│ WRITE PATH │            │ READ PATH  │      │
│ Post Svc   │            │ Timeline   │──────┘
└─────┬──────┘            │ Service    │
      │                   └──────┬─────┘
      │ 1. write post            │
      ▼                          │
┌──────────────┐                 │
│ posts store  │◄────────────────┼── hydrate post bodies
│ (Cassandra)  │                 │
└─────┬────────┘                 │
      │ 2. emit event            │
      ▼                          │
┌───────────────────────┐        │
│ Kafka "post.created"  │        │
└──────────┬────────────┘        │
           │                     │
           ▼                     │
┌────────────────────────────┐   │
│   FAN-OUT SERVICE          │   │
│   (consumer group, scaled) │   │
│                            │   │
│  ┌──────────────────────┐  │   │
│  │ author.follower_count│  │   │
│  │      > 100k ?        │  │   │
│  └───┬──────────────┬───┘  │   │
│      │ NO           │ YES  │   │
│      ▼              ▼      │   │
│  fan out to      DO NOTHING│   │
│  followers       (pull at  │   │
│  (batched        read time)│   │
│   writes)                  │   │
└──────┬─────────────────────┘   │
       │                          │
       ▼                          │
┌────────────────────┐            │
│  user_timeline     │◄───────────┤ A. read precomputed feed
│  PK=user_id        │            │
│  SK=post_id DESC   │            │
│  (Cassandra)       │            │
└────────────────────┘            │
                                   │
┌────────────────────┐            │
│ Celebrity Cache    │◄───────────┤ B. pull celebrity recent posts
│ Redis: celeb_id →  │            │    (one cached list serves
│  [recent 100 posts]│            │     all their followers)
└────────────────────┘            │
                                   │
                            ┌──────▼──────────┐
                            │  MERGE + SORT   │
                            │  A ∪ B by ts    │
                            │  filter deleted │
                            │  paginate       │
                            └──────┬──────────┘
                                   ▼
                            ┌─────────────┐
                            │ Redis cache │  hot users' assembled
                            │ timeline:uid│  timeline, TTL ~30s
                            └─────────────┘
```

</details>

**Read path in words:** Timeline Service checks Redis for an assembled timeline. On miss, it reads the user's precomputed `user_timeline` rows (cheap, single partition), separately fetches recent posts from the handful of celebrities that user follows (cached, so near-free), merges the two lists by post_id descending, hydrates post bodies, and caches the result for 30 seconds.

---
