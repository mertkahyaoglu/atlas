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
  outOfScope:
    - "Dynamic pricing"
    - "Bot detection specifics (mention it matters enormously)"
    - "Secondary market"
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

<!-- tab: Today · 500k in the queue -->

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

Buyers reach the application only through the virtual waiting room, which queues arrivals in a Redis sorted set under signed queue tokens and admits them at a controlled rate, about 1,000 per second, each for roughly 10 minutes. Behind the API Gateway, admitted users browse a deliberately stale Redis seat map and book against the Primary DB, which is sharded by event.

1. With a valid queue token, the API Gateway passes a hold request to the booking path. The transaction locks the chosen seats with `SELECT … FOR UPDATE`, taking the locks in sorted order. If every seat is still `AVAILABLE`, it marks them `HELD` with `held_by` and `expires_at`, inserts the hold and commits. If any seat is gone, it rolls back and returns 409 with nearby alternatives.
2. Within the 10-minute hold, checkout runs as a saga that verifies the hold, charges the buyer, marks the seats `SOLD` and issues tickets.
3. Every seat change in the Primary DB is published to Kafka `seat.events`, which invalidates the cached seat map and pushes live seat updates over WebSocket.

The browse path never takes a lock. Seat maps come from the CDN as static pages and from the Redis seat map, which has a TTL of 2-5 seconds and is refreshed by those seat events. Beside the booking path, the hold expiry sweeper scans the Primary DB and returns seats from expired holds to `AVAILABLE`.

<!-- tab: At 10x · 5M in the queue -->

```mermaid
flowchart TB
    Fans([~5M fans · a 40-show tour on sale]) --> Edge["CDN edge · bot checks<br/>issues SIGNED queue tokens<br/>random number per arrival<br/>no central write"]
    Presale[("Verified-fan presale<br/>registration days before<br/>codes to a chosen subset")] -.-> Edge
    Edge --> Gate{"token number<br/>below admit cursor?"}
    Cursor[("Admit cursor · one per show<br/>raised at the rate booking absorbs")] --> Gate
    Gate -- "not yet · position shown at the edge" --> Edge
    Gate -- "admitted" --> GW[API Gateway<br/>no valid token, no entry]

    GW --> Counts[("Section counts · Redis<br/>available seats per section and price<br/>no per-seat map to millions of screens")]
    GW --> BestAvail

    subgraph BOOK ["Booking path · one shard per show"]
        direction TB
        BestAvail["1 · buyer picks section + price<br/>not individual seats"]
        Alloc["2 · allocator per section<br/>hands out best contiguous seats in order<br/>no competing row locks, no 409 storm"]
        Hold["3 · HOLD · seats HELD with expires_at<br/>INSERT hold · COMMIT"]
        Checkout["4 · checkout SAGA<br/>payment queue extends the hold<br/>while the PSP call waits"]
        BestAvail --> Alloc --> Hold --> Checkout
    end

    Hold --> DB
    Checkout --> DB
    DB[("Primary DB · Postgres<br/>ACID · CP · sharded by show<br/>40 shows = 40 isolated on-sales")]
    DB --> Sweeper["Hold expiry sweeper<br/>ALSO checked at read time"]
    DB --> SeatEvents{{"Kafka · seat.events<br/>→ section counts"}}
    SeatEvents -.-> Counts

    classDef db fill:#34526e,stroke:#6cb2ee,color:#d7dee8
    classDef cache fill:#623e43,stroke:#f07a73,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef external fill:#2f5a4d,stroke:#5cc98f,color:#d7dee8
    classDef gateway fill:#22565e,stroke:#38bdc1,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    classDef scaled stroke-dasharray:5 3
    class DB,Presale db
    class Counts,Cursor cache
    class SeatEvents queue
    class Edge external
    class GW gateway
    class Gate,Alloc hot
    class Edge,Presale,Gate,Cursor,Counts,BestAvail,Alloc,Checkout scaled

    click Edge href "/docs/04-caching" "Role: issues signed queue tokens with a random number at the CDN edge, with no central write.<br/>Trade-off: a signing key to rotate, and tokens must be bound to an account so they can't be shared."
    click Presale href "/docs/08-reliability-and-operations" "Role: verified-fan registration days before, with codes issued to a chosen subset.<br/>Trade-off: fans who miss registration can't join the main sale."
    click Gate href "/docs/08-reliability-and-operations" "Role: admits tokens whose number is below the show's admit cursor.<br/>Trade-off: a fan's position is only an estimate until the cursor reaches them."
    click Cursor href "/docs/04-caching" "Role: one number per show, raised at the rate booking can absorb.<br/>Trade-off: too high and contention returns; too low and seats sell slowly."
    click Counts href "/docs/04-caching" "Role: available seats per section and price, refreshed from seat events.<br/>Trade-off: no per-seat map while the rush lasts."
    click BestAvail href "/docs/03-consistency-and-distributed-systems" "Role: takes a section and price instead of specific seats.<br/>Trade-off: buyers lose seat choice during the rush."
    click Alloc href "/docs/03-consistency-and-distributed-systems" "Role: one allocator per section hands out the best remaining contiguous seats in order.<br/>Trade-off: a serial allocator caps throughput per section, which the admit cursor is sized for."
    click Checkout href "/docs/03-consistency-and-distributed-systems" "Role: the checkout saga, with a payment queue that extends holds while waiting.<br/>Trade-off: seats stay held longer when the processor is slow."
    click DB href "/docs/02-data-storage" "Role: the single authority on seat state, one shard per show.<br/>Trade-off: strict consistency caps writes per show, which is why admission exists."
```

Same product at 10x, roughly what the biggest stadium tours have drawn: millions of people in the queue at once for dozens of shows. 100x would put 50M people in one queue, more than any on-sale has seen, so 10x is the realistic tier. Dashed outlines mark what's new or reshaped compared with today's design.

| | Today | At 10x |
|---|---|---|
| Buyers at on-sale | 500k | ~5M |
| Request spike | 100k/sec | ~1M/sec |
| Seats on sale at once | 50k, one show | ~2M, a 40-show tour |
| Central writes per arrival | 1 Redis sorted-set insert | none |

**What changes, and the number that forces it**

1. **The waiting room moves to the edge.** With ~5M arrivals in the first seconds, the waiting room's own Redis sorted set becomes the thing that falls over. The CDN edge issues each arrival a signed token carrying a random queue number (random rather than arrival time, so network speed doesn't decide the order), and nothing central is written. Admission becomes one number per show, the admit cursor: tokens below it get in, and it rises at the rate booking can absorb. Each fan's position is computed at the edge from their own token.
2. **Presale registration flattens the spike.** The lottery from the fairness follow-up becomes the default for big tours. Verified fans register days before, codes go to a chosen subset, and the on-sale starts with a known audience instead of an unknown stampede. Bot filtering happens at registration, where it doesn't cost real buyers their conversion.
3. **Buyers pick a section; the server picks seats.** With millions of people choosing individual seats, most hold attempts collide on the same few best seats: row locks wait, and every 409 turns into an immediate retry. Best-available allocation lets the buyer choose a section and price, and one allocator per section hands out the best remaining contiguous seats serially. Contention moves from competing row locks to an orderly queue in front of an allocator that never conflicts with itself. The cost is less choice; pick-your-seat can reopen once the rush drains.
4. **Browsing shows counts, not seat maps.** Pushing live per-seat maps to millions of screens is a bigger fan-out than the sale itself. Admitted users see available seats per section and price, updated every few seconds from the seat event stream.
5. **Checkout queues payments and extends holds.** Selling ~2M seats in minutes runs into processor rate limits. Checkouts wait in a payment queue, and a hold's TTL is extended while its checkout is waiting there, so a slow processor never releases seats someone is paying for.
6. **Each show is its own isolated on-sale.** A 40-show tour is 40 simultaneous on-sales. Sharding by event already isolates their data; now each show also gets its own admit cursor and allocators, so a sold-out Saturday can't slow down Tuesday.

**What stays the same**

A seat can never be double-sold: holds are still ACID writes against Postgres, and hold expiry is still checked by both the sweeper and at read time. Display stays eventually consistent while the purchase stays strongly consistent, checkout is still a saga that retries issuance after a successful charge, and admission control still sits in front of the application tier. There is still no eventual consistency anywhere in the purchase path.

<!-- /tabs -->

---
