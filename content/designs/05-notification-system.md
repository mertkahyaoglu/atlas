---
group: "design"
order: 5
title: "Notification System"
summary: "Events from many producers, matched to recipients, delivered in-app, by email and by push, without losing any."
hardPart: "Third-party delivery channels fail constantly and are rate limited. Nothing may be lost, nothing visibly duplicated, and one flaky provider must not take down the rest."
tags: ["event-driven", "kafka", "fanout", "idempotency", "circuit-breaker"]
hardPartDetail: "Third-party delivery channels (APNs, FCM, SMTP) fail constantly and are rate limited. How do you guarantee nothing is lost, nothing is duplicated visibly, and one flaky provider doesn't take down the rest?"
concepts:
  - "event-driven architecture"
  - "pub/sub"
  - "fan-out"
  - "at-least-once + idempotency"
  - "retry with backoff"
  - "dead letter queues"
  - "multi-channel delivery"
  - "preference filtering"
  - "deduplication/collapsing"
  - "digests"
requirements:
  functional:
    - "Producers (PR service, CI, comments) emit events"
    - "Match events to interested recipients (watchers, mentions, participants)"
    - "Deliver via in-app inbox, email, mobile push"
    - "Per-user, per-type, per-channel preferences; mute threads and repos"
    - "Mark read/unread, unread counts"
    - "Collapse related notifications (\"10 people liked your post\")"
    - "Email digests instead of per-event mail"
  nonFunctional:
    - "In-app delivery within seconds; email/push within minutes is fine"
    - "Never silently drop a notification"
    - "At-least-once delivery with no *visible* duplicates"
    - "Availability over consistency (stale unread count is acceptable)"
  outOfScope: "ML ranking of notifications, spam classification."
scale:
  numbers: |-
    Events:     5,000/sec avg, 50,000/sec peak (a big repo goes viral, CI storm)
    Fan-out:    ~10 recipients avg; "celebrity repos" up to 500k watchers
    Deliveries: 50k-500k/sec at peak
    Records:    ~0.5 KB → ~2 TB/day
  conclusion: "The peak fan-out multiplier is what sizes the fan-out worker fleet, and the 500k-watcher case forces the same hybrid as the feed design."
tradeoffs:
  - title: "Why Kafka and not a plain queue"
    body: |-
      Replay. If the fan-out consumer ships a bug that drops a category of notification, you reset the offset and reprocess. If you add a fifth delivery channel next quarter, it reads history from day one. A queue that deletes on consume gives you none of that.
  - title: "Delivery guarantee framing"
    body: |-
      Say it precisely: *at-least-once delivery with idempotent consumers, producing exactly-once effects.* The dedupe key is `(user_id, event_id)` as the storage primary key for the notification, and `(notification_id, channel)` in the delivery log so a retried job that already sent an email doesn't send a second one.
  - title: "Check preferences at delivery time, not fan-out time"
    body: |-
      If a user mutes a thread after the fan-out ran but before the email worker fires, the mute should take effect. Filtering at write time bakes in a stale decision. Small detail, real product consequence.
  - title: "Collapsing / deduplication"
    body: |-
      Ten likes should be one notification. Implement as a short time-windowed aggregation keyed by `(recipient, type, entity)`: hold for N minutes, merge arrivals, then emit. This is a windowed stream operation, and it also protects the email provider from a burst.
  - title: "Bulkheads per provider"
    body: |-
      APNs, FCM, and SMTP each get their own worker pool, their own queue, and their own circuit breaker. When SMTP is degraded, push notifications must keep flowing. Sharing a thread pool across providers means one bad provider stalls everything — this is the bulkhead pattern and it's worth naming.
  - title: "Provider rate limits force batching"
    body: |-
      A CI storm generating 100k email jobs will get you throttled or blocked by your email provider. Two mitigations: batch into digests (one email covering many events) and apply a leaky bucket in front of the provider so output is smooth regardless of input burstiness.
  - title: "Digests are a scheduled drain"
    body: |-
      Buffer events per user, and a scheduler fires hourly/daily to render and send one email. Requires the user's timezone so "daily at 9am" means their 9am.
  - title: "Quiet hours and caps"
    body: |-
      Never push at 3am local; cap pushes per user per day. Needs per-user timezone and a counter. Cheap to implement, big product win, and shows you're thinking about the human on the other end.
  - title: "Unread counts"
    body: |-
      Counting rows on every page load is a range scan per request. Maintain a Redis counter with atomic `INCR`/`DECR`, accept that it drifts (missed decrements, race conditions), and run a periodic reconciliation job against the store. Say the drift is acceptable because this is an AP system — the failure mode is a badge showing 3 instead of 2.
  - title: "Celebrity repos"
    body: |-
      Same hybrid as the feed: above a watcher threshold, don't fan out. Store the event once, and merge it in at read time for users who watch that repo. One cached "recent events for repo X" list serves all 500k watchers.
  - title: "Large fan-out jobs must not block small ones"
    body: |-
      A 500k-recipient job sitting in a partition starves ordinary notifications behind it. Either chunk large jobs into sub-tasks or route them to a separate low-priority queue. Priority isolation.
  - title: "What to monitor"
    body: |-
      Kafka consumer lag (the leading indicator), DLQ depth (alert, not dashboard), per-provider delivery success rate and latency, fan-out worker error rate, and end-to-end p99 from event emitted to in-app delivery.
followUps:
  - question: "A user both watches the repo and is @mentioned — two notifications?"
    answer: "Dedupe during fan-out on `event_id`; if both paths generate a notification, the unique constraint on `(user_id, event_id)` collapses them. Prefer the higher-priority reason when choosing the display text."
  - question: "How do you backfill after a consumer outage?"
    answer: "Reset the consumer group offset to before the outage and reprocess. Idempotent writes make reprocessing safe — this is exactly why idempotency and replay are designed together."
  - question: "What if the notification store write succeeds but the delivery job publish fails?"
    answer: "Transactional outbox: write the notification and an outbox row in one transaction, and have a separate publisher drain the outbox. Removes the dual-write problem."
  - question: "How do you handle expired device tokens?"
    answer: "APNs/FCM return them in feedback responses; mark the token dead and stop using it. Otherwise your invalid-token error rate grows forever and pollutes your delivery metrics."
  - question: "How do you support a new channel (SMS, Slack)?"
    answer: "Add a consumer group on `delivery.jobs` and a preference field. Nothing upstream changes — that's the payoff of event-driven architecture."
  - question: "What breaks first at 10x?"
    answer: "Fan-out worker throughput and the per-provider rate limits. The store scales linearly by user_id partitioning."
---
# 05 — Notification System (GitHub / multi-channel)

## API / Model

```api
POST /internal/events || || 202 || producers only; separate from the user API
GET /v1/notifications?cursor=&filter=unread || || 200 notification page
POST /v1/notifications/{id}/read || || 204
POST /v1/notifications/read-all || || 204
PUT /v1/preferences || {type, channels[], digest_frequency} || 200
POST /v1/repos/{id}/mute || || 204
```

```schema
subscriptions || PK: repo_id SK: user_id || type (watching|participating|mentioned), muted || fan-out lookup direction
notifications || PK: user_id SK: notification_id (Snowflake, DESC) UNIQUE: (user_id, event_id) || event_id, type, entity_ref, read, created_at || the unique constraint is the idempotency key
preferences || PK: user_id || per-type channel map, quiet_hours, timezone, digest_freq ||
delivery_log || PK: (notification_id, channel) || status, attempts, last_error || dedupe and observability
unread_counts || || Redis: unread:{user_id} → int || atomic INCR / DECR
```

---

## High-level architecture

```mermaid
flowchart TB
    subgraph P ["Producers"]
        direction LR
        PR[PR Service]
        CI[CI Service]
        CM[Comments]
        IS[Issues]
    end

    PR --> Bus
    CI --> Bus
    CM --> Bus
    IS --> Bus

    Bus{{"Kafka · activity.events<br/>partitioned by entity_id<br/>7-day retention = replayable"}}

    subgraph FO ["Fan-out service"]
        direction TB
        Audience["1 · resolve audience<br/>watchers + mentions + participants"]
        Celeb{"2 · celebrity repo?<br/>> 100k watchers"}
        Filter["3 · filter muted and prefs"]
        Collapse["4 · collapse duplicates<br/>'10 people liked your post'"]
        Write["5 · batched idempotent write<br/>PK = user_id + event_id"]
        Audience --> Celeb
        Celeb -- "no" --> Filter --> Collapse --> Write
        Celeb -- "yes · pull at read time" --> ReadPull[Mark for read-time merge]
    end

    Bus --> Audience
    Write --> Store[("notifications store<br/>Cassandra · PK = user_id")]
    Write --> Jobs{{"Kafka · delivery.jobs<br/>one job per channel"}}

    subgraph D ["Delivery workers · bulkheaded per provider"]
        direction LR
        InApp["In-app worker"]
        PushW["Push worker<br/>quiet hours check"]
        EmailW["Email worker<br/>digest buffering"]
    end

    Jobs --> InApp
    Jobs --> PushW
    Jobs --> EmailW

    InApp --> WS["Redis pub/sub → WS gateway"]
    PushW --> APNs["APNs / FCM"]
    EmailW --> SMTP["SMTP provider"]

    APNs --> Retry
    SMTP --> Retry
    Retry["Retry · exponential backoff + jitter<br/>circuit breaker per provider"]
    Retry -- "attempts exhausted" --> DLQ[("Dead letter queue<br/>ALERT on depth · replay after fix")]

    Store --> ReadAPI["Read API<br/>cursor paginated"]
    ReadPull -.-> ReadAPI
    Counters[("Redis · unread counters<br/>atomic INCR/DECR<br/>periodically reconciled")] --> ReadAPI

    classDef store fill:#1d2734,stroke:#35455a,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Store,DLQ,Counters store
    class Celeb hot

    click Bus href "/docs/05-async-messaging-and-event-driven" "Role: every product event enters here, and 7-day retention allows replay after a bug.<br/>Trade-off: ordering only per entity, and consumers must dedupe."
    click Store href "/docs/02-data-storage" "Role: each user's notification inbox, read with cursor pagination.<br/>Trade-off: any query not keyed by user_id needs another table or index."
    click Jobs href "/docs/05-async-messaging-and-event-driven" "Role: one job per channel so email, push and in-app fail and retry independently.<br/>Trade-off: one notification's channels can arrive out of sync."
    click WS href "/docs/07-apis-and-communication" "Role: pushes in-app notifications to open browser tabs instantly.<br/>Trade-off: best effort only, so closed tabs rely on the stored inbox."
    click DLQ href "/docs/05-async-messaging-and-event-driven" "Role: holds deliveries that exhausted their retries so they don't block the queue.<br/>Trade-off: without alerting and a replay process, messages here silently rot."
    click Counters href "/docs/04-caching" "Role: unread badge counts without scanning the inbox.<br/>Trade-off: counts can drift from the truth, hence periodic reconciliation."
```

<details>
<summary>Plain-text version of this diagram</summary>

```text
 ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
 │ PR Service │ │ CI Service │ │ Comments   │ │ Issues     │   PRODUCERS
 └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
       └──────────────┴───────┬───────┴──────────────┘
                              ▼
        ┌────────────────────────────────────────────┐
        │   KAFKA  topic: activity.events             │
        │   partitioned by entity_id (ordering per    │
        │   PR/issue); 7-day retention → REPLAYABLE   │
        └───────────────────┬────────────────────────┘
                            ▼
   ┌────────────────────────────────────────────────────────┐
   │              FAN-OUT SERVICE (consumer group)            │
   │                                                          │
   │  1. resolve audience ──► [Subscription Service]          │
   │       watchers + @mentions + thread participants         │
   │                                                          │
   │  2. is repo a "celebrity" (>100k watchers)?              │
   │       YES → skip eager fan-out, mark for read-time pull  │
   │       NO  → continue                                     │
   │                                                          │
   │  3. filter: muted? preference off? actor == recipient?   │
   │                                                          │
   │  4. COLLAPSE: same type + same entity within window      │
   │       → merge into one "N people did X"                  │
   │                                                          │
   │  5. batched idempotent write, PK=(user_id, event_id)     │
   └───────┬──────────────────────────────────┬──────────────┘
           │                                   │
           ▼                                   ▼
  ┌──────────────────────┐        ┌────────────────────────────┐
  │  notifications store  │        │  KAFKA topic: delivery.jobs │
  │  Cassandra            │        │  (one job per channel)      │
  │  PK=user_id           │        └──────┬────────┬────────┬───┘
  │  SK=notif_id DESC     │               │        │        │
  └──────────┬───────────┘    ┌───────────┘        │        └───────────┐
             │                 ▼                    ▼                    ▼
             │        ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
             │        │ IN-APP WORKER  │  │  PUSH WORKER   │  │  EMAIL WORKER  │
             │        │                │  │                │  │                │
             │        │ check prefs at │  │ quiet hours?   │  │ digest mode?   │
             │        │ DELIVERY time  │  │ device tokens  │  │  → buffer      │
             │        └───────┬────────┘  └───────┬────────┘  └───────┬────────┘
             │                │                    │                   │
             │                ▼                    ▼                   ▼
             │      ┌──────────────────┐  ┌────────────────┐  ┌────────────────┐
             │      │ Redis pub/sub    │  │  APNs / FCM    │  │  SMTP provider │
             │      │  → WS gateway    │  │  (3rd party,   │  │  (3rd party,   │
             │      │  → live client   │  │   rate limited)│  │   rate limited)│
             │      └──────────────────┘  └───────┬────────┘  └───────┬────────┘
             │                                     │                   │
             │            ┌────────────────────────┴───────────────────┘
             │            ▼
             │   ┌──────────────────────────────────────────┐
             │   │  RETRY:  exponential backoff + JITTER      │
             │   │   1s → 2s → 4s → 8s → 16s                  │
             │   │   circuit breaker per provider (bulkhead)  │
             │   └────────────────┬─────────────────────────┘
             │                     │ exhausted
             │                     ▼
             │            ┌─────────────────────┐
             │            │  DEAD LETTER QUEUE  │  ← ALERT on depth
             │            │  payload + error +  │    replay after fix
             │            │  attempt count      │
             │            └─────────────────────┘
             │
             ▼
     ┌────────────────────┐        ┌─────────────────────────┐
     │ READ API           │◄───────│ Redis: unread counters   │
     │ cursor-paginated   │        │ atomic INCR/DECR, drift  │
     │ merge: own feed +  │        │ reconciled periodically  │
     │ celebrity pull     │        └─────────────────────────┘
     └────────────────────┘
```

</details>

Events pass through two Kafka topics: `activity.events` feeds the Fan-out service, and `delivery.jobs` feeds delivery workers that are bulkheaded per provider. The notifications store and the Read API sit beside that pipeline as each user's inbox.

1. The PR Service, CI Service, Comments and Issues publish to Kafka `activity.events`, partitioned by `entity_id`. The Fan-out service consumes it and resolves the audience: watchers, mentions and participants.
2. It checks whether the event belongs to a celebrity repo with more than 100k watchers. If it does, the service writes nothing per user and marks the event for read-time merge.
3. For every other event, it filters the audience by mutes and preferences.
4. It collapses duplicates, so ten likes become one "10 people liked your post" notification.
5. It makes one batched, idempotent write keyed by `user_id` and `event_id` to the notifications store, and puts one job per channel on Kafka `delivery.jobs`.
6. The In-app worker, Push worker and Email worker each take their own jobs. The in-app worker sends through Redis pub/sub to the WS gateway, the push worker checks quiet hours before calling APNs / FCM, and the email worker buffers digests before calling the SMTP provider.

Failed provider calls go to the retry stage, which backs off exponentially with jitter behind a circuit breaker per provider. Jobs that run out of attempts land in the dead letter queue, which alerts on depth and is replayed after a fix. On the read side, the Read API pages through the notifications store by cursor, merges celebrity-repo events at read time, and takes badge counts from the Redis unread counters.

---
