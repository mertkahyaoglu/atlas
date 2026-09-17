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
  outOfScope:
    - "DMs"
    - "Search"
    - "ML ranking"
    - "Ads"
    - "Notifications"
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

```erd
# Users and posts
users || is_celebrity is a bool derived from follower_count
+ user_id || bigint || PK
+ name || text
+ follower_count || bigint
+ is_celebrity || boolean
posts || post_id is a Snowflake, so it is time-sortable
+ post_id || bigint || PK
+ author_id || bigint || → users
+ text || text
+ media_urls || list<text>
+ created_at || timestamp
+ reply_to || bigint || null → posts
# Graph and feed · denormalized for reads
social_graph || who I follow
+ follower_id || bigint || PK → users
+ followee_id || bigint || SK → users
social_graph (reverse) || who follows me; a second, denormalized table for fan-out lookup
+ followee_id || bigint || PK → users
+ follower_id || bigint || SK → users
user_timeline || the precomputed feed; references only, not the post body
+ user_id || bigint || PK → users
+ post_id || bigint || SK DESC → posts
+ author_id || bigint || → users
```

Two directions of the social graph are stored separately because fan-out needs "who follows X" while the UI needs "who does X follow". Same data, two access patterns, two tables. That's Module 2 in action.

---

## High-level architecture

<!-- tab: Today · ~150k reads/s -->

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

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef gateway fill:#22565e,stroke:#38bdc1,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class PostStore,Feed db
    class CelebCache,TimelineCache cache
    class Media blob
    class Decide hot
    class Bus queue
    class GW gateway

    click Bus href "/docs/05-async-messaging-and-event-driven" "Role: decouples posting from fan-out so the write returns immediately.<br/>Trade-off: followers see the post seconds later, and consumers must be idempotent."
    click Skip href "/docs/06-fanout-and-feeds" "Role: celebrity posts are not copied into millions of timelines.<br/>Trade-off: every read must merge those posts in, which moves work to read time."
    click CelebCache href "/docs/04-caching" "Role: one hot list per celebrity, shared by all of their followers at read time.<br/>Trade-off: extremely hot keys that need replication and careful invalidation."
    click TimelineCache href "/docs/04-caching" "Role: serves the fully merged home feed without recomputing it.<br/>Trade-off: up to 30s stale, so a brand-new post may not show immediately."
    click Media href "/docs/09-specialized-building-blocks" "Role: serves images and video from the edge, never through app servers.<br/>Trade-off: egress cost and slow invalidation, so deletes take time to disappear."
```

The feed is a write path and a read path behind one API Gateway. They never call each other: the write path fills two stores, and the read path merges them.

1. The client's `POST /posts` passes the API Gateway, which handles auth and rate limiting, and reaches the Post Service.
2. The Post Service writes the post to the posts store in Cassandra and publishes `post.created` to Kafka, then returns without waiting for fan-out.
3. The Fan-out service, running as a consumer group, reads the event and checks whether the author has more than 100k followers.
4. For an ordinary author, it fans out to followers with batched, idempotent writes, adding one reference row per follower to `user_timeline`, keyed by `user_id` and sorted by `post_id` descending.
5. For a celebrity, it skips eager fan-out. The post lands in the Redis celebrity cache instead, where one list serves every follower at read time.

Reads never wait on fan-out. A `GET /timeline` reaches the Timeline Service, which touches only what the write path left behind, `user_timeline` rows and the celebrity cache, and keeps each merged page in the Redis assembled timeline for 30 seconds. Images and video bypass both paths: the response carries media URLs, and the client loads the bytes from Blob storage + CDN.

**Read path in words:** Timeline Service checks Redis for an assembled timeline. On miss, it reads the user's precomputed `user_timeline` rows (cheap, single partition), separately fetches recent posts from the handful of celebrities that user follows (cached, so near-free), merges the two lists by post_id descending, hydrates post bodies, and caches the result for 30 seconds.

<!-- tab: At 10x · ~1.5M reads/s -->

```mermaid
flowchart TB
    Client([Mobile / Web client]) --> Geo["GeoDNS + regional LB<br/>nearest of ~5 regions"]
    Geo --> GW["API Gateway · per region<br/>auth · rate limit"]
    GW -- "POST /posts" --> PostSvc
    GW -- "GET /timeline" --> Timeline

    subgraph WRITE ["Write path · author's home region"]
        direction TB
        PostSvc[Post Service]
        PostStore[("posts · Cassandra<br/>replicated to every region")]
        Bus{{"Kafka · post.created<br/>mirrored to every region"}}
        PostSvc --> PostStore
        PostSvc --> Bus
    end

    subgraph FANOUT ["Fan-out · runs in each follower's region"]
        direction TB
        Decide{"ACTIVE followers<br/>> threshold ?"}
        Followers[("Follower lists · chunked<br/>~10k ids per partition")]
        Lanes["Priority lanes by fan-out size<br/>small authors never queue<br/>behind a 5M-follower post"]
        Skip["Skip eager fan-out<br/>mark for read-time pull"]
        Decide -- "no" --> Lanes
        Decide -- "yes · celebrity" --> Skip
        Followers -- "page through" --> Lanes
    end
    Bus --> Decide

    Lanes --> Feed[("Timeline lists · in memory<br/>capped at 800 refs<br/>active users only")]
    Skip --> CelebCache[("Celebrity cache<br/>one copy per region")]

    subgraph READ ["Read path · reader's region"]
        direction TB
        Timeline[Timeline Service]
        TimelineCache[("Assembled timeline<br/>TTL 30s")]
        Merge["Merge and sort by post_id<br/>cap celebrity lists merged<br/>no list → rebuild from posts"]
        Timeline -- "cache miss" --> Merge
        Merge -- "store 30s" --> TimelineCache
    end
    Feed -- "precomputed refs" --> Merge
    CelebCache -- "celebrity posts" --> Merge
    PostStore -. "returning dormant user" .-> Merge

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef gateway fill:#22565e,stroke:#38bdc1,color:#d7dee8
    classDef lb fill:#5d3759,stroke:#e066b2,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    classDef scaled stroke-dasharray:5 3
    class PostStore,Followers db
    class Feed,CelebCache,TimelineCache cache
    class Bus queue
    class GW gateway
    class Geo lb
    class Decide hot
    class Geo,PostStore,Bus,Decide,Followers,Lanes,Feed,CelebCache,Merge scaled

    click Geo href "/docs/01-foundations" "Role: sends each user to the nearest of ~5 regions.<br/>Trade-off: when a region fails, its users land on the others, which need headroom for them."
    click PostStore href "/docs/02-data-storage" "Role: every post, replicated to all regions for hydration and rebuilds.<br/>Trade-off: replication lag means a rebuild can briefly miss a post made seconds ago elsewhere."
    click Bus href "/docs/05-async-messaging-and-event-driven" "Role: carries each post to every region, where local consumers fan it out.<br/>Trade-off: cross-region mirroring adds seconds before distant followers see the post."
    click Decide href "/docs/06-fanout-and-feeds" "Role: chooses eager fan-out or read-time pull by active followers, not total.<br/>Trade-off: activity has to be tracked per follower, and the threshold needs tuning."
    click Followers href "/docs/02-data-storage" "Role: the reverse follow graph, split into fixed-size partitions per account.<br/>Trade-off: one account's followers become many partition reads, done in parallel."
    click Lanes href "/docs/08-reliability-and-operations" "Role: separate worker pools by fan-out size, so big posts can't starve small ones.<br/>Trade-off: more pools to size, and a big author's post takes longer to land."
    click Feed href "/docs/04-caching" "Role: each active user's capped timeline, appended and trimmed in memory.<br/>Trade-off: RAM costs far more than disk, so dormant users are dropped and rebuilt on return."
    click CelebCache href "/docs/04-caching" "Role: recent posts per celebrity, one copy in every region.<br/>Trade-off: the hottest keys on the platform, read millions of times per second."
    click Merge href "/docs/06-fanout-and-feeds" "Role: combines precomputed refs with a capped number of celebrity lists.<br/>Trade-off: someone following hundreds of celebrities sees the quieter ones a refresh later."
```

Same product at 10x the traffic. A 100x jump would mean more daily users than there are people online, so 10x (roughly the largest social apps today) is the realistic next tier. Dashed outlines mark what's new or reshaped compared with today's design.

| | Today | At 10x |
|---|---|---|
| Daily active users | 300M | ~3B |
| Posts at peak | 1,500/sec | 15,000/sec |
| Timeline reads | ~150k/sec | ~1.5M/sec |
| Feed writes | 10B/day | ~100B/day, ~3.5M/sec at peak |
| Largest account | 100M followers | ~500M followers |
| Regions | 1 | ~5 |

**What changes, and the number that forces it**

1. **One region → about five.** At 3B users the audience is everywhere, and a 200ms p99 can't absorb a cross-ocean round trip on every timeline load. Each region serves reads from its own timeline lists and caches. Posts are written in the author's home region, and both the posts table and `post.created` are replicated to every other region. Snowflake IDs already carry datacenter bits, so IDs stay unique without coordination.
2. **Fan-out runs where the follower lives.** Each region's fan-out consumers read the mirrored topic and only write timelines for followers homed in that region. A post from Tokyo to followers in São Paulo crosses the ocean once, as one event, not as millions of timeline writes.
3. **The threshold counts active followers.** ~3.5M timeline writes/sec at peak is what breaks first, as the 10x follow-up predicts. Deciding eager vs pull on *active* followers removes most of it, because a dormant follower never gets a row: a 50M-follower account with 2M daily actives fans out like a 2M one.
4. **Priority lanes by fan-out size.** A post to millions of active followers takes minutes of worker time. Routing authors into lanes by fan-out size, each with its own worker pool, means an ordinary user's post reaches their 200 followers in seconds even while a large post is still fanning out. It's the same bulkhead idea as the notification design.
5. **Timelines move to capped in-memory lists.** A timeline is only ever appended to, trimmed at 800, and read whole, so a replicated in-memory list store (the shape Twitter ran on Redis) beats Cassandra rows for both writes and reads. Only active users keep a list: ~1B users × 800 refs × ~20 bytes is ~16 TB of RAM before replication, split across regions by where users live. A returning dormant user's timeline is rebuilt from the posts table on first load.
6. **Follower lists are chunked.** A 500M-follower reverse graph in one partition is a hot, unbounded row. Splitting each list into partitions of ~10k ids lets fan-out workers page through it in parallel and keeps every partition a normal size.
7. **The read-time merge gets a cap.** Once more accounts sit on the pull side, a user following hundreds of them would merge hundreds of lists per load. The merge takes only the few dozen celebrity lists with the most recent posts, and quieter ones surface on the next refresh of the assembled cache.

**What stays the same**

The hybrid itself: fan-out on write for ordinary authors, merge at read time for large ones. Fan-out writes stay idempotent on `(user_id, post_id)`, pagination stays cursor-based on Snowflake IDs, deletes are still filtered at read time rather than fanned out, and media bytes still come from blob storage and the CDN, never through app servers. At 10x the same split is simply applied per region and per lane.

<!-- /tabs -->

---
