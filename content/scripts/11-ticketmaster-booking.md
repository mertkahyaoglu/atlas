# Ticketmaster / Booking — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design Ticketmaster — specifically, buying tickets for a big concert.

@you
Let me agree what the hard moment is, because booking a quiet Tuesday show and a stadium on-sale are different systems.

1. Reserved seating where you pick a specific seat, or general admission — or both?
2. When I pick seats, are they held for me while I check out? For how long?
3. What does an on-sale look like — near-zero traffic, then everyone at 10:00:00?
4. Is fairness a requirement, or does the fastest connection win?
5. Pricing, bots, resale — ours?

@interviewer
Both reserved and GA. Yes, seats are held for about ten minutes. On-sale is exactly that spike. Fairness matters. Dynamic pricing and resale are out. Bots — you tell me.

@you
Then here's what I'm building, and what I'm not.

**Functional:** browse events and seat availability; select seats and hold them while checking out; complete the purchase, with the hold expiring and releasing if abandoned; reserved seating and general admission; cancellations and refunds.

**Non-functional:** **never double-sell a seat** — that's a hard invariant. Survive a spike of near-zero traffic to 100x for about sixty seconds. **Fair-ish access**, not purely "fastest network wins". And a boundary I want to state early: **availability display can be slightly stale, the purchase cannot.**

**Out of scope, deliberately:** dynamic pricing and the secondary market. Bot detection I'll treat as out of scope in detail, but I want to say it matters enormously — at a real on-sale, most of the traffic is automated.

@interviewer
Numbers?

@you
Yes, and I think they invert the usual instincts.

@note · Playbook 10.1, phase 1
"Display can be stale, the purchase cannot" is the core trade-off of the whole design, stated as a requirement in the first five minutes. Every later decision — the cache TTL, the 409, the locks — is an application of that one sentence.

## Estimate · 3 min · A tiny dataset under an enormous burst

@you
- **Normal traffic:** ~1,000 requests/sec.
- **On-sale spike:** ~100,000 requests/sec for about sixty seconds. That's the design driver.
- **Seats per big event:** ~50,000.
- **Buyers:** ~500,000 people chasing 50,000 seats — **10:1 oversubscription**.

The conclusion: **the dataset is tiny and the traffic is enormous and bursty.** 50,000 rows fits in memory on a laptop. So I don't need sharding for capacity or a bigger cluster. What breaks is **contention**: 500,000 people trying to touch the same 50,000 rows at once, and the database dies not on CPU but on *waiting* for row locks. The answer is **admission control** — keep them from touching the rows simultaneously.

@interviewer
So you wouldn't scale the database for the on-sale?

@you
Scaling it doesn't help much. More replicas don't help writes to the same rows, and more shards don't help when every buyer wants the same event. The lock on seat A14 is one lock no matter how big the cluster is. The lever is how many people we let reach it per second.

@note · Playbook 10.1, phase 2
Candidates who bring feed instincts — cache everything, fan out, eventual consistency — fail this prompt. "The dataset fits on a laptop; the problem is contention" is the estimate that stops you from doing that.

## API and data model · 5 min · A state column and a version column

@you
Six endpoints:

- `GET /v1/events/{id}` — event plus an availability summary.
- `GET /v1/events/{id}/seats?section=` — the seat map, **cached, may be stale**.
- `POST /v1/events/{id}/holds` with an `Idempotency-Key` and `{seat_ids[]}` → `201 {hold_id, expires_at}`, or **`409` if a seat is already taken**.
- `POST /v1/holds/{id}/checkout` with an `Idempotency-Key` and `{payment_token}` → `201 booking_id`.
- `DELETE /v1/holds/{id}` — release early.
- `GET /v1/queue/status` — waiting-room position.

@you · at the whiteboard
Five tables:

| Table | Key | The point |
|---|---|---|
| `events` | PK `event_id` | venue, datetime, `on_sale_at` |
| `seats` | PK `(event_id, seat_id)` | **`state: AVAILABLE \| HELD \| SOLD`**, `held_by`, `hold_expires_at`, **`version`** |
| `holds` | PK `hold_id` | `seat_ids[]`, `user_id`, `expires_at` — ~10 minutes |
| `bookings` | PK `booking_id` | `hold_id`, `payment_id`, `state` |
| `inventory_ga` | PK `(event_id, tier)` | `total`, `sold` — a counter for general admission |

The `state` column plus the `version` column on `seats` is the whole concurrency-control story. Everything else is supporting cast.

@interviewer
General admission gets a counter, not seat rows?

@you
Right — it's a different problem. No seat map, no specific seat to fight over, so no row-level contention. An atomic conditional decrement:

`UPDATE inventory_ga SET sold = sold + 1 WHERE event_id = ? AND tier = ? AND sold < total`

One affected row means you got a ticket; zero means sold out. It's much cheaper, and I'd call out the distinction explicitly, because reserved seating is where the hard part lives.

@note · Playbook 10.1, phase 3
Pointing at two columns and saying "that's the whole concurrency story" focuses the interviewer on the right thing. Distinguishing GA from reserved seating before being asked answers a follow-up that almost always comes.

## High-level design · 10 min · A waiting room, a stale browse path, and a locked booking path

@you · drawing
Three parts, in the order a buyer meets them.

**The waiting room.** 500,000 people hit buy at 10:00:00.

1. Each arrival gets a **signed queue token**, recorded in a **Redis sorted set** scored by arrival time.
2. They see a **position and an ETA**.
3. We **admit at a controlled rate** — say 1,000 a second — matched to what the booking tier can actually process.
4. An admitted token grants about ten minutes of access. **The API gateway rejects anyone without a valid token.**

**The browse path.** Admitted users look at a seat map served from **Redis with a 2–5 second TTL**, backed by static maps on the CDN. It never takes a lock.

**The booking path.** A hold request:

1. `BEGIN`. `SELECT … FOR UPDATE` on the chosen seats `WHERE state = 'AVAILABLE'`, **locks taken in sorted seat-ID order**.
2. All available? `UPDATE` them to `HELD` with `held_by` and `hold_expires_at`, insert the hold, `COMMIT`.
3. Any taken? `ROLLBACK`, and return `409` with **nearby alternatives**.
4. Within ten minutes, **checkout** runs as a saga.

Every seat change is published to `seat.events`, which invalidates the cached map and pushes live updates to open seat maps.

@interviewer
Why is the waiting room the most important component? It's just a queue.

@you
Because without it, 500,000 concurrent requests hit 50,000 rows and the database dies on lock contention. The waiting room **converts an uncontrolled stampede into a controlled admission rate.** It also makes load **predictable** — the booking tier sees 1,000 admissions a second whether the event is a local band or the biggest tour of the year. And the user gets an honest queue position instead of an error page.

The insight is where it sits: **in front of the application tier, not inside it.** Rate limiting inside the booking service still accepts the connections and holds resources for them.

@interviewer
The seat map says a seat is free. I click it. It's taken.

@you
That's **expected, and correct.** The map is a cached snapshot, a few seconds old — any attempt to make browse perfectly accurate at 100,000 requests a second would destroy the database. The contract with the user is: **the map is a hint, the truth is decided when you press hold**, and a `409` there is a normal outcome the UI handles gracefully — "that seat was just taken, here are three nearby". Live updates over the socket shrink how often it happens, but they can't eliminate it, and they don't need to.

@interviewer
And sharding?

@you
**By event.** All contention for one event lands on one partition, which sounds bad but is the goal: a hot on-sale for one stadium can't degrade every other event on the platform. It's blast-radius containment. And since one event is 50,000 rows, one partition handles it easily once the waiting room caps the arrival rate.

@note · Playbook 10.1, phase 4
Answering "why shard by event?" with blast radius rather than capacity shows you understood the estimate. Treating the stale-map 409 as a designed outcome, with its UX, is what separates a correct design from a usable one.

## Deep dive · 15 min · Locks under contention, holds that expire, and checkout as a saga

@you
The hard part is the hold under contention: which locking strategy, and how holds behave when people abandon them. Checkout as a saga is the second. And fairness in the queue is a third, if you'd like. Shall I start with locking?

@interviewer
Yes. Why pessimistic locking? Optimistic is usually faster.

@you
It depends entirely on the **conflict rate**, and here the conflict rate is enormous.

| | Pessimistic — `SELECT … FOR UPDATE` | Optimistic — version compare-and-swap |
|---|---|---|
| How | lock the rows, check, update; others block | `UPDATE … WHERE seat_id = ? AND version = ? AND state = 'AVAILABLE'`; zero rows means you lost |
| Good when | contention is heavy | conflicts are rare |
| Bad because | holds locks; deadlock risk if lock order varies | under 10:1 oversubscription almost everyone loses and **retries** |

Optimistic locking is great for an ordinary Tuesday booking. At an on-sale, most attempts conflict, every loser retries immediately, and **retries amplify load exactly when we can least afford it** — a retry storm on the hottest rows. Pessimistic does no wasted work: a transaction waits for the lock, finds the seat gone, and returns a `409` once.

@interviewer
You mentioned sorted order. Why?

@you
Deadlocks. If I want seats A and B, and you want B and A, and I lock A while you lock B, we each wait for the other forever — or until the database kills one of us. **Always acquire locks in a consistent order** — sort the seat IDs — and the cycle can't form. It's a small detail and a very real bug.

@interviewer
Two users select overlapping seats at the same moment.

@you
The first transaction to acquire the row locks wins. The second blocks briefly, then finds the seats no longer `AVAILABLE` and gets a `409` with alternatives. The UX of losing gracefully matters as much as the locking — a buyer who loses a seat and is immediately offered a comparable one usually still buys.

@interviewer
A user holds seats and closes their laptop.

@you
The hold's TTL expires and the seats return to inventory. But **expiry must be checked twice**:

- A **sweeper** reclaims holds where `hold_expires_at < now()`. If I relied on it alone, there's a window between expiry and the next sweep where an expired hold still blocks a sale.
- **At hold time**, the check treats `HELD` with an expired `hold_expires_at` as available. If I relied on that alone, expired holds would linger in the data and distort availability.

So do both. A hold that never expires means one abandoned checkout removes a seat from sale permanently.

@interviewer
Walk me through checkout.

@you
It's a **saga**, and the substance is deciding which failures compensate and which retry.

1. Verify the hold is still ours and unexpired.
2. **Charge** payment, with an idempotency key.
3. Mark the seats **`SOLD`**.
4. **Issue tickets.**

If the **charge fails**, compensate: release the hold, seats back to `AVAILABLE`. If **ticket issuance fails after a successful charge**, do *not* release the seats — the customer has paid. Retry issuance until it succeeds, and alert if it doesn't. Releasing a paid seat to resell it would be the double sale we promised never to do.

@interviewer
Can you use eventual consistency anywhere in the purchase path?

@you
**No.** Browse, counts, the live map — all eventually consistent, and deliberately. But from the hold to the sale, every write is a strongly consistent ACID transaction. That's the point of this problem, and I don't want to hedge on it.

@interviewer
How do you make the queue fair?

@you
Strict FIFO by arrival favours whoever has the fastest connection and the closest data centre — and bots. A common alternative is a **randomized lottery**: everyone who joins during a registration window gets a random position. It's fairer, and it **flattens the spike entirely**, because admission is scheduled rather than raced.

And bots, briefly, because they're the real production problem: queue tokens tied to **authenticated accounts**; device fingerprinting; **per-account purchase caps enforced at hold time**; rate limits per account; and CAPTCHAs **on entry to the queue**, not at checkout, where they'd cost real conversions.

@note · Playbook 10.1, phase 5
"Which one depends on the conflict rate, and here it's enormous" is the locking answer this prompt wants. Walking through which saga failures compensate and which retry — rather than just saying "saga" — is what depth looks like.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
At 10x, **nothing should break, if the waiting room is doing its job** — that's its purpose. The booking tier sees the same admission rate. Without it, **database lock contention** breaks first, well before CPU or storage.

What does start to strain at ~5M people in a queue for a 40-show tour:

1. **The waiting room itself.** A central sorted-set insert per arrival becomes the thing that falls over. So the **CDN edge issues signed tokens** carrying a random queue number, with no central write, and admission becomes one **admit cursor** per show: tokens below it get in.
2. **Registration-based presales** become the default, so the on-sale starts with a known audience.
3. **Best-available allocation.** With millions choosing individual seats, everyone collides on the same best seats. Let buyers pick a section and price, and one allocator per section hands out the best contiguous seats serially — an orderly queue instead of competing locks.
4. **Section counts instead of live seat maps**, because pushing per-seat updates to millions of screens is a bigger fan-out than the sale.
5. **A payment queue** that extends holds while waiting, since selling 2M seats in minutes hits processor rate limits.

@interviewer
A venue changes the seat map after sales start.

@you
**Version the seat map.** Existing holds and bookings reference the version they were made under, and a new version applies to new holds only. Never mutate a seat map in place once sales are live — a booking for a seat that no longer exists in the current map has to still mean something.

@interviewer
Refunds and cancellations?

@you
A reverse saga — refund the payment, return the seats to `AVAILABLE` — plus a product decision about whether returned seats go back on public sale or to a waitlist. For a sold-out show, a waitlist is fairer and avoids a mini on-sale every time someone cancels.

@you
What I'd monitor: **lock wait time** on the seats table, the leading indicator that admission is too fast; the **admission rate against booking throughput**, which is the dial I'd actually turn; `409` rate on holds; hold expiry rate, since a spike means checkout is failing or too slow; payment failures per processor; and waiting-room abandonment, which is the user-facing cost of the queue.

@you
To close: this is a contention problem, not a scale problem. A waiting room in front of the application converts a stampede into a steady admission rate. Browse is deliberately stale. Holds are pessimistic, sorted-order row locks with a TTL checked twice. Checkout is a saga that compensates before the charge and retries after it. And the event shard is the blast radius, so one sold-out stadium can't take the rest of the platform with it.

@note · Playbook 10.5
"Nothing breaks at 10x if the waiting room works" is only credible because you then name what strains the waiting room itself. Naming the admission rate as the dial you'd turn shows you'd operate this, not just design it.
