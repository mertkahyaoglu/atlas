---
group: "design"
order: 11
title: "Ticketmaster / Booking"
summary: "Fifty thousand people wanting the same hundred seats in the same second."
hardPart: "This is contention, not scale. Row lock contention breaks first, not throughput — so the answer is admission control in front of the application tier, not a bigger cluster."
tags: ["concurrency", "consistency", "postgres", "saga"]
hardPartDetail: "This is a **contention** problem, not a scale problem. 50,000 people all want the same 100 seats in the same second. Row-level lock contention, not throughput, is what breaks. Candidates who apply feed-system instincts (cache everything, fan out, eventual consistency) fail this one."
concepts:
  - "pessimistic vs optimistic locking"
  - "distributed locks with TTL"
  - "extreme contention on a small dataset"
  - "virtual waiting rooms"
  - "admission control"
  - "sagas"
  - "cache-vs-truth divergence"
requirements:
  functional:
    - "Browse events, view seat availability"
    - "Select specific seats, hold them temporarily while checking out"
    - "Complete purchase; hold expires and releases if abandoned"
    - "Support both reserved seating and general admission"
    - "Cancellations and refunds"
  nonFunctional:
    - "**Never double-sell a seat.** Hard invariant."
    - "Handle massive spikes: near-zero traffic, then 100x for 60 seconds at on-sale"
    - "Fair-ish access; not purely \"fastest network wins\""
    - "Availability display can be slightly stale; the *purchase* cannot be"
  outOfScope: "dynamic pricing, bot detection specifics (mention it matters enormously), secondary market."
scale:
  numbers: |-
    Normal traffic:        1,000 req/sec
    On-sale spike:         100,000 req/sec for ~60s   ← the design driver
    Seats per big event:   50,000
    Concurrent buyers:     500,000 chasing 50,000 seats (10:1 oversubscription)
  conclusion: "The dataset is tiny (50,000 rows) and the traffic is enormous and bursty. This inverts every normal instinct: you don't need sharding or a big cluster, you need **admission control** to keep 500,000 people from touching 50,000 rows simultaneously."
tradeoffs:
  - title: "The waiting room is the most important component"
    body: |-
      Without it, 500,000 concurrent requests hit 50,000 rows and the database dies on lock contention — not on CPU, on *waiting*. The waiting room converts an uncontrolled stampede into a controlled admission rate matched to what the booking tier can actually process. It also gives users an honest experience (a queue position and ETA) instead of an error page, and it makes the system's load predictable rather than a function of how popular the event turned out to be.

      This is admission control from Module 8, and recognizing that it belongs *before* the application tier rather than inside it is the senior insight.
  - title: "Pessimistic vs optimistic locking — choose and justify"
    body: |-
      ```
      PESSIMISTIC (SELECT ... FOR UPDATE)
        Lock the rows, then check and update. Other transactions block.
        ✓ No wasted work, no retry storms
        ✓ Correct under heavy contention          ← the case here
        ✗ Holds locks; risk of deadlock if lock order varies

      OPTIMISTIC (version column, compare-and-swap)
        UPDATE seats SET state='HELD', version=version+1
         WHERE seat_id=? AND version=? AND state='AVAILABLE'
        Check rows-affected: 0 means someone beat you.
        ✓ No locks held, great when conflicts are RARE
        ✗ Under 10:1 oversubscription, almost everyone loses and retries
          → retry storm makes contention worse
      ```

      For a hot on-sale, **pessimistic wins**, because conflicts are the norm rather than the exception and optimistic retries amplify load exactly when you can least afford it. Optimistic is fine for ordinary, low-contention bookings. Being able to say "which one depends on the conflict rate, and here the conflict rate is enormous" is the answer they're looking for.
  - title: "Deadlock prevention"
    body: |-
      When holding multiple seats, always acquire locks in a consistent order (sort seat IDs). Two transactions grabbing seats A and B in opposite orders will deadlock. Sorting eliminates the cycle. Small detail, real bug, good signal.
  - title: "Holds need a TTL, and expiry must be checked twice"
    body: |-
      A hold that never expires means an abandoned checkout permanently removes a seat from sale. Set `hold_expires_at`, run a sweeper to reclaim expired holds *and* check expiry at read/hold time. Relying solely on the sweeper means a brief window where an expired hold still blocks a sale; relying solely on read-time checks means expired holds linger in the data. Do both.
  - title: "The cache is deliberately stale, and that's correct"
    body: |-
      The seat map shown while browsing is a cached snapshot with a 2-5 second TTL. It will sometimes show a seat that was just taken. That is acceptable and unavoidable — any attempt to make the browse view perfectly accurate under 100k req/sec will destroy the database. The contract with the user is: the map is a hint, the truth is decided when you press "hold," and a 409 at that point is a normal, expected outcome that the UI must handle gracefully. Stating this boundary between "eventually consistent display" and "strongly consistent transaction" is the core trade-off of the design.
  - title: "Shard by event"
    body: |-
      All contention for one event lands on one partition. That sounds bad, but it's actually the goal: it means a hot on-sale for one stadium show cannot degrade every other event on the platform. Blast-radius containment. Since the dataset per event is tiny, one partition handles it comfortably once the waiting room caps the arrival rate.
  - title: "General admission is a different problem"
    body: |-
      No seat map, just a counter. Use an atomic decrement (`UPDATE ... SET sold = sold + 1 WHERE sold < total`) or a Redis counter with a conditional. Much cheaper, no row-level contention, and worth distinguishing from reserved seating explicitly — they often ask about both.
  - title: "Checkout is a saga"
    body: |-
      Charge payment, mark seats sold, issue tickets. If payment fails, release the hold. If ticket issuance fails after a successful charge, do *not* release seats — retry issuance, because the customer has paid. Deciding which failures compensate and which retry is the substance of saga design, and it's worth walking through rather than just saying "saga."
  - title: "Bots"
    body: |-
      At a real on-sale, most of that 500,000 is automated. Defences: queue tokens tied to authenticated accounts, device fingerprinting, per-account purchase caps enforced at hold time, CAPTCHAs on entry to the queue rather than at checkout (where they'd cost you real conversions), and rate limits per account. Mention it — a Ticketmaster design that ignores bots is missing the actual production problem.
followUps:
  - question: "A user holds seats then closes their laptop."
    answer: "TTL expires, sweeper releases, seats return to inventory. This is why holds are time-boxed and why the expiry is checked at both read and write time."
  - question: "Two users select overlapping seats simultaneously."
    answer: "First transaction to acquire the row locks wins; the second finds them non-`AVAILABLE` and gets a 409 with a suggestion of nearby alternatives. The UX of losing gracefully matters as much as the locking."
  - question: "How do you make the queue fair?"
    answer: "Strict FIFO by arrival favours whoever has the fastest connection. A common alternative is a randomized lottery among everyone who joined during a registration window — fairer, and it flattens the spike entirely since admission is scheduled. Worth offering as an alternative design."
  - question: "Can you use eventual consistency anywhere in the purchase path?"
    answer: "No. That's the point of this problem, and saying so firmly is better than hedging."
  - question: "How do you handle a venue changing the seat map after sales start?"
    answer: "Version the seat map; existing holds and bookings reference the version they were made under. Never mutate a seat map in place once sales are live."
  - question: "What breaks first at 10x?"
    answer: "Nothing, if the waiting room is doing its job — that's its purpose. Without it, database lock contention breaks first, well before CPU or storage."
  - question: "Refunds and cancellations?"
    answer: "Reverse via a saga (refund payment, return seats to `AVAILABLE`), and decide the product rule on whether returned seats go back on public sale or to a waitlist."
---
# 11 — Ticketmaster / Booking System

## API / Model

```api
GET /v1/events/{id} || || 200 event + availability summary
GET /v1/events/{id}/seats?section= || || 200 seat map || cached, may be stale
POST /v1/events/{id}/holds || Idempotency-Key  {seat_ids[]} || 201 409 hold_id, expires_at || 409 Conflict when a seat is already held
POST /v1/holds/{id}/checkout || Idempotency-Key  {payment_token} || 201 booking_id
DEL /v1/holds/{id} || || 204 || release early
GET /v1/queue/status || || 200 waiting room position
```

```schema
events || PK: event_id || venue, datetime, on_sale_at, status ||
seats || PK: (event_id, seat_id) || section, row, number, price_tier, state, held_by (session), hold_expires_at, version || state: AVAILABLE | HELD | SOLD; version enables optimistic locking
holds || PK: hold_id || event_id, seat_ids[], user_id, created_at, expires_at, state || TTL ~10 min
bookings || PK: booking_id || hold_id, user_id, seat_ids[], payment_id, state ||
inventory_ga || PK: (event_id, tier) || total, sold || counter for general admission
```

The `state` field on `seats` plus a `version` column is the whole concurrency-control story. Everything else is supporting cast.

---

## High-level architecture

```mermaid
flowchart TB
    Rush([500,000 users hit buy<br/>at 10:00:00 sharp]) --> CDNEdge[CDN · static seat maps]
    CDNEdge --> Queue

    subgraph WR ["Virtual waiting room — the key defence"]
        direction TB
        Queue["Signed queue token on arrival<br/>Redis sorted set · score = arrival ts"]
        Waiting["WAITING · 490,000<br/>position and ETA shown"]
        Admit["Admit at a CONTROLLED RATE<br/>e.g. 1,000/sec — matched to what<br/>the booking tier can actually handle"]
        Admitted["ADMITTED · 10,000<br/>token grants ~10 min access"]
        Queue --> Waiting --> Admit --> Admitted
    end

    Admitted --> GW[API Gateway<br/>no valid queue token, no entry]

    GW --> Browse

    Browse[("Browse path · Redis seat map<br/>TTL 2-5s · INTENTIONALLY STALE<br/>the map is a hint,<br/>truth is decided at hold time")]

    subgraph BOOK ["Booking path · contended"]
        direction TB
        Hold["1 · HOLD SEATS<br/>BEGIN TRANSACTION<br/>SELECT … FOR UPDATE<br/>WHERE state = AVAILABLE<br/>locks acquired in SORTED ORDER<br/>to avoid deadlock"]
        Verdict{"all available?"}
        Ok["UPDATE state = HELD<br/>set held_by and expires_at<br/>INSERT hold · COMMIT"]
        Conflict["ROLLBACK → 409<br/>suggest nearby alternatives"]
        Checkout["2 · CHECKOUT within 10 min · SAGA<br/>verify hold → charge → seats SOLD<br/>→ issue tickets<br/>compensate: refund + release"]
        Hold --> Verdict
        Verdict -- "yes" --> Ok --> Checkout
        Verdict -- "no" --> Conflict
    end

    GW --> Hold

    Checkout --> DB
    Ok --> DB
    DB[("Primary DB · Postgres<br/>ACID · CP<br/>SHARDED BY EVENT so one hot<br/>on-sale can't degrade the platform")]

    DB --> Sweeper["Hold expiry sweeper<br/>release where expires_at < now()<br/>ALSO checked at read time —<br/>never rely on the sweeper alone"]
    DB --> SeatEvents{{"Kafka · seat.events<br/>→ cache invalidate<br/>→ live seat map over WS"}}
    SeatEvents -.-> Browse

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef external fill:#2f5a4d,stroke:#5cc98f,color:#d7dee8
    classDef gateway fill:#22565e,stroke:#38bdc1,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class DB db
    class Browse cache
    class Queue,Hold hot
    class SeatEvents queue
    class CDNEdge external
    class GW gateway

    click Queue href "/docs/04-caching" "Role: a waiting room that admits users at the rate booking can handle.<br/>Trade-off: users wait, but the booking path survives the on-sale spike."
    click Browse href "/docs/04-caching" "Role: a fast, deliberately stale seat map for browsing.<br/>Trade-off: a seat shown as free may already be held, and the hold step decides."
    click DB href "/docs/02-data-storage" "Role: the single authority on seat state, sharded by event.<br/>Trade-off: strict consistency caps write throughput on each event's shard."
    click SeatEvents href "/docs/05-async-messaging-and-event-driven" "Role: seat changes invalidate caches and refresh live seat maps.<br/>Trade-off: maps lag slightly, so clients must handle hold conflicts."
```

<details>
<summary>Plain-text version of this diagram</summary>

```text
        500,000 users hit "buy" at 10:00:00 sharp
                          │
                          ▼
  ┌──────────────────────────────────────────────────────────┐
  │              CDN  (static seat maps, event pages)         │
  └────────────────────────┬─────────────────────────────────┘
                            ▼
  ┌──────────────────────────────────────────────────────────┐
  │           VIRTUAL WAITING ROOM  ⚠ THE KEY DEFENCE          │
  │                                                            │
  │   All users → issued a signed queue token on arrival       │
  │   Redis sorted set: score = arrival timestamp              │
  │                                                            │
  │   ┌────────────────────────────────────────────────┐      │
  │   │ WAITING (490,000)                               │      │
  │   │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓      │      │
  │   │  position shown, ETA estimated                  │      │
  │   └────────────────────┬───────────────────────────┘      │
  │                         │ admit at a CONTROLLED RATE       │
  │                         │ (e.g. 1,000/sec — matched to     │
  │                         │  what the booking tier can       │
  │                         │  actually handle)                │
  │                         ▼                                  │
  │   ┌────────────────────────────────────────────────┐      │
  │   │ ADMITTED (10,000) — token grants ~10 min access │      │
  │   └────────────────────┬───────────────────────────┘      │
  └─────────────────────────┼─────────────────────────────────┘
                             ▼
  ┌──────────────────────────────────────────────────────────┐
  │                     API GATEWAY                           │
  │            validate queue token — no token, no entry       │
  └────────────────────────┬─────────────────────────────────┘
          ┌────────────────┴─────────────────┐
          ▼                                   ▼
  ┌────────────────────┐          ┌──────────────────────────┐
  │  BROWSE PATH        │          │   BOOKING PATH            │
  │  (read, cacheable)  │          │   (write, contended)      │
  │                     │          │                           │
  │ ┌─────────────────┐ │          │ ┌───────────────────────┐ │
  │ │ Redis: seat map │ │          │ │ 1. HOLD SEATS          │ │
  │ │ availability    │ │          │ │                        │ │
  │ │ TTL ~2-5s       │ │          │ │  BEGIN TRANSACTION     │ │
  │ │                 │ │          │ │  SELECT ... FOR UPDATE │ │
  │ │ ⚠ INTENTIONALLY │ │          │ │    WHERE seat_id IN () │ │
  │ │   STALE. Users  │ │          │ │    AND state=AVAILABLE │ │
  │ │   see "maybe    │ │          │ │  ← row locks, ordered  │ │
  │ │   available";   │ │          │ │    consistently to     │ │
  │ │   truth is      │ │          │ │    avoid DEADLOCK      │ │
  │ │   decided at    │ │          │ │                        │ │
  │ │   hold time     │ │          │ │  if all AVAILABLE:     │ │
  │ └─────────────────┘ │          │ │    UPDATE state=HELD,  │ │
  └────────────────────┘          │ │      held_by, expires  │ │
                                    │ │    INSERT hold          │ │
                                    │ │  COMMIT                │ │
                                    │ │  else ROLLBACK → 409   │ │
                                    │ └──────────┬────────────┘ │
                                    │             ▼              │
                                    │ ┌───────────────────────┐ │
                                    │ │ 2. CHECKOUT (≤10 min)  │ │
                                    │ │    SAGA:               │ │
                                    │ │    verify hold valid   │ │
                                    │ │      → charge payment  │ │
                                    │ │      → seats = SOLD    │ │
                                    │ │      → issue tickets   │ │
                                    │ │    compensate on fail: │ │
                                    │ │      refund + release  │ │
                                    │ └──────────┬────────────┘ │
                                    └─────────────┼─────────────┘
                                                   ▼
                              ┌────────────────────────────────┐
                              │   PRIMARY DB (Postgres)         │
                              │   single-writer per event       │
                              │   ACID, CP — correctness wins   │
                              │   partition/shard BY EVENT      │
                              │   (one hot event ≠ everyone's   │
                              │    problem)                     │
                              └────────────┬───────────────────┘
                                            │
                    ┌───────────────────────┼──────────────────┐
                    ▼                        ▼                  ▼
        ┌────────────────────┐  ┌────────────────────┐  ┌──────────────┐
        │ HOLD EXPIRY SWEEPER │  │ Kafka: seat.events │  │ Read replicas│
        │ periodic job:       │  │  → cache invalidate│  │ (browse only)│
        │  UPDATE seats       │  │  → live seat map   │  └──────────────┘
        │  SET state=AVAILABLE│  │    push via WS     │
        │  WHERE state=HELD   │  └────────────────────┘
        │  AND expires < now()│
        │ ⚠ also check expiry │
        │   at read time —    │
        │   never rely on the │
        │   sweeper alone     │
        └────────────────────┘
```

</details>

Buyers reach the application only through the virtual waiting room, which queues arrivals in a Redis sorted set under signed queue tokens and admits them at a controlled rate, about 1,000 per second, each for roughly 10 minutes. Behind the API Gateway, admitted users browse a deliberately stale Redis seat map and book against the Primary DB, which is sharded by event.

1. With a valid queue token, the API Gateway passes a hold request to the booking path. The transaction locks the chosen seats with `SELECT … FOR UPDATE`, taking the locks in sorted order. If every seat is still `AVAILABLE`, it marks them `HELD` with `held_by` and `expires_at`, inserts the hold and commits. If any seat is gone, it rolls back and returns 409 with nearby alternatives.
2. Within the 10-minute hold, checkout runs as a saga that verifies the hold, charges the buyer, marks the seats `SOLD` and issues tickets.
3. Every seat change in the Primary DB is published to Kafka `seat.events`, which invalidates the cached seat map and pushes live seat updates over WebSocket.

The browse path never takes a lock. Seat maps come from the CDN as static pages and from the Redis seat map, which has a TTL of 2-5 seconds and is refreshed by those seat events. Beside the booking path, the hold expiry sweeper scans the Primary DB and returns seats from expired holds to `AVAILABLE`.

---
