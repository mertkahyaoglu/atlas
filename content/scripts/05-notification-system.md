# Notification System — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design the notification system for something like GitHub.

@you
Let me play back what I think that covers, and you tell me where I'm wrong.

Many producers — pull requests, CI, comments, issues — emit events. We work out who cares about each one, and deliver it through several channels. Questions:

1. Which channels — an in-app inbox, email, mobile push? Anything else?
2. Who is a recipient — people watching a repo, people @mentioned, participants in a thread?
3. What control do users have — per type, per channel, muting a thread or a whole repo?
4. How fast? Does an email need to arrive in seconds?
5. Do we collapse related notifications, and send digests instead of an email per event?

@interviewer
In-app, email and push. Watchers, mentions and participants. Users can set preferences per type and channel, and mute threads and repos. In-app should be seconds, email and push can be minutes. Yes to collapsing and digests.

@you
Then here's what I'm building, and what I'm not.

**Functional:** producers emit events; we match each to its recipients; deliver in-app, by email and by push; per-user, per-type, per-channel preferences, with mutes; read and unread with counts; collapsing — "10 people reacted to your comment" — and email digests.

**Non-functional:** in-app within seconds, email and push within minutes. **Never silently drop a notification.** **At-least-once delivery with no *visible* duplicates** — I'm choosing those words carefully, because exactly-once to an email provider doesn't exist. Availability over consistency: a stale unread badge is fine.

**Out of scope, deliberately:** ML ranking of notifications and spam classification.

@interviewer
Good. Scale?

@you
Let me estimate, because the average and the peak are very different animals here.

@note · Playbook 10.3
"At-least-once with no visible duplicates" is the delivery-guarantee sentence stated as a requirement. Committing to it in the first five minutes means every later mechanism — the unique key, the delivery log — has a reason to exist.

## Estimate · 3 min · The peak multiplier sizes the fleet

@you
- **Events:** ~5,000/sec on average, but ~50,000/sec at peak — a big repo goes viral, or a CI system has a storm and fails a thousand builds at once.
- **Fan-out:** about 10 recipients per event on average. But some repos have **500k watchers**.
- **Deliveries:** 50k to 500k per second at peak.
- **Records:** ~0.5 KB per notification × ~10 × 5,000/sec is ~2 TB a day.

Two conclusions. First, **the peak fan-out multiplier is what sizes the fan-out worker fleet** — average traffic would run on a handful of workers, but the storm is what we're designing for. Second, the **500k-watcher repo forces the same hybrid as a feed**: I can't write half a million inbox rows for one push to a popular repo.

And a third, quieter one: 500k deliveries a second is far beyond what any email provider accepts from one sender, so provider rate limits are a hard constraint, not a detail.

@note · Playbook 10.1, phase 2
Estimating the peak, not the average, and naming the thing it sizes — the worker fleet — is the useful conclusion. Noticing that the providers can't take your peak turns an estimate into a design constraint before the diagram exists.

## API and data model · 5 min · A producer API, a user API, and an idempotency key in the schema

@you
Two audiences, so two sets of endpoints:

- `POST /internal/events` → `202`. **Producers only**, on the internal network, separate from the user API.
- `GET /v1/notifications?cursor=&filter=unread` — the inbox, cursor-paginated.
- `POST /v1/notifications/{id}/read` and `POST /v1/notifications/read-all`.
- `PUT /v1/preferences {type, channels[], digest_frequency}`.
- `POST /v1/repos/{id}/mute`.

@you · at the whiteboard
Five pieces of state:

| Table | Key | The point |
|---|---|---|
| `subscriptions` | PK `repo_id`, SK `user_id` | `type: watching \| participating \| mentioned`, `muted` — keyed for fan-out's lookup direction |
| `notifications` | PK `user_id`, SK `notification_id` DESC, **UNIQUE `(user_id, event_id)`** | the inbox; the unique constraint is the idempotency key |
| `preferences` | PK `user_id` | per-type channel map, `quiet_hours`, `timezone`, `digest_freq` |
| `delivery_log` | PK `(notification_id, channel)` | `status`, `attempts`, `last_error` — dedupe for sends, and observability |
| `unread_counts` | Redis `unread:{user_id}` | atomic `INCR` / `DECR` |

Two different idempotency keys, at two different layers. `(user_id, event_id)` means an event replayed through fan-out produces one inbox row, not two. `(notification_id, channel)` means a retried delivery job that already sent the email doesn't send a second one.

@interviewer
A user watches the repo and is also @mentioned in the same comment. Two notifications?

@you
One. Both paths produce a notification for the same `(user_id, event_id)`, so the unique constraint collapses them — I'd also dedupe in memory during fan-out so we don't rely on the constraint for the common case. For the display text, prefer the higher-priority reason: "you were mentioned" beats "activity on a repo you watch".

@note · Playbook 10.1, phase 3
Two idempotency keys at two layers is the detail that proves you know where duplicates actually come from — replayed fan-out on one side, retried sends on the other. The watch-plus-mention question is the interviewer checking the first one.

## High-level design · 10 min · Two topics, a fan-out service, and bulkheaded workers

@you · drawing
Let me trace one comment on a pull request.

1. The **comments service** publishes to Kafka **`activity.events`**, partitioned by `entity_id`, so events about one PR stay in order.
2. The **fan-out service** consumes it and **resolves the audience**: repo watchers, the people mentioned, the thread's participants.
3. **Celebrity check:** does this repo have more than ~100k watchers? If so, don't write per user — I'll come back to it.
4. Otherwise, **filter** out muted users.
5. **Collapse**: if the same recipient got a notification of the same type about the same entity a moment ago, merge.
6. **One batched, idempotent write** to the **notifications store** — Cassandra, keyed by `user_id` — and one job per channel onto **`delivery.jobs`**.
7. **Delivery workers**, one pool per channel, take their jobs: in-app goes through Redis pub/sub to the WebSocket gateway; push goes to APNs and FCM after a quiet-hours check; email is buffered for digests, then goes to the SMTP provider.

Failed provider calls go to **retry with exponential backoff and jitter**, behind a **circuit breaker per provider**. When attempts are exhausted, the job lands in a **dead letter queue** — which alerts on depth and gets replayed after a fix.

@you
The read side is separate. The **read API** pages the inbox by cursor from the notifications store, merges in any celebrity-repo events, and takes the badge number from **Redis unread counters**.

@interviewer
Why Kafka rather than a simple job queue?

@you
**Replay.** If the fan-out consumer ships a bug that silently drops a category of notification, I reset the consumer group's offset to before the deploy and reprocess — and because writes are idempotent on `(user_id, event_id)`, users who already got theirs don't get a second. And if we add a new channel next quarter, it can read history from day one. A queue that deletes on consume gives me neither.

Replay and idempotency are designed together: replay without idempotency is a duplicate storm, and idempotency without replay can't recover from a bug.

@interviewer
The notification row commits, but publishing the delivery job fails. Now what?

@you
That's a dual write, and I'd remove it with a **transactional outbox**: write the notification and an outbox row in one transaction, and a separate publisher drains the outbox into `delivery.jobs`. If the publisher crashes, it resumes from the outbox, and the delivery log's key makes a double publish harmless. With Cassandra I'd get the same effect by making the fan-out consumer commit its Kafka offset only after both writes succeed, so a failure replays the event — which is idempotent anyway.

@note · Playbook 10.1, phase 4
"Why Kafka?" answered with "replay, because a consumer bug is inevitable" is the justification that turns a buzzword into a decision. And tying replay to idempotency shows you know neither is safe alone.

## Deep dive · 15 min · Unreliable providers, and fan-out that doesn't starve itself

@you
Two parts I think are genuinely hard. One: delivery through providers that fail constantly and rate limit us, without losing or visibly duplicating anything. Two: fan-out when one event goes to 500k people without starving everyone else. Which would you like first?

@interviewer
Providers.

@you
Start with isolation. APNs, FCM and SMTP each get **their own worker pool, their own queue and their own circuit breaker.** That's the bulkhead pattern. When the email provider is degraded, workers block on slow SMTP connections — and if push shared that thread pool, push would stall too. With bulkheads, a bad email provider fills one queue and nothing else notices.

The circuit breaker is what stops us hammering a provider that's already failing. After a threshold of errors it opens, jobs go straight back to delayed retry without a network call, and it half-opens periodically to probe for recovery.

@you
Then retries. **Exponential backoff with jitter**, so a thousand jobs that failed together don't retry together. A bounded number of attempts, then the **DLQ** — and DLQ depth is an **alert, not a dashboard**, because "never silently drop" means a message sitting in a DLQ unnoticed is exactly the failure we promised not to have.

Duplicates: each worker checks `delivery_log` for `(notification_id, channel)` before sending and records the result after. There's still a window — the send succeeds and the worker dies before recording it — which is why the promise is at-least-once. For push I narrow it with collapse IDs, so a duplicate push replaces the first on the device instead of appearing twice.

@interviewer
A CI storm produces 100k emails in a minute.

@you
Our provider will throttle us or block us, and a blocked sending domain takes days to recover. Two mitigations.

**Batch into digests.** A user whose builds are failing doesn't want 400 emails, they want one: "38 failed builds in `api-server`." Digests are a scheduled drain — events buffer per user, and a scheduler renders and sends one email hourly or daily. It needs the user's **timezone**, so "daily at 9am" is their 9am.

**Smooth the output.** A **leaky bucket** in front of each provider, so output is steady regardless of how bursty the input is. The queue absorbs the storm and email arrives minutes late, which the requirements allow.

And collapsing upstream helps both: a short time-windowed aggregation keyed by `(recipient, type, entity)` — hold for a few minutes, merge arrivals, emit one. Ten reactions become one notification, and the provider never sees the burst.

@interviewer
A user mutes a thread after fan-out ran but before the email goes out.

@you
The mute should win, so **preferences are checked at delivery time, not at fan-out time.** Filtering at fan-out bakes in a decision that can be minutes stale by the time a digest or a retry fires. Fan-out can still drop obvious mutes early to save work, but the delivery worker makes the final call.

The same place enforces **quiet hours and caps**: never push at 3am local time, and cap pushes per user per day. It's a timezone lookup and a counter — cheap — and it's the difference between a notification system people keep enabled and one they turn off.

@interviewer
Device tokens expire. What happens?

@you
APNs and FCM tell us — in the response to a send, or in feedback. We mark the token dead and stop using it. If we don't, the invalid-token error rate grows forever, burns provider quota, and pollutes the delivery success metric I'd be alerting on.

@you
Now the 500k-watcher repo, briefly. Same hybrid as a feed: above a watcher threshold, **don't fan out.** Store the event once, and the read API merges "recent events for repo X" into the inbox of anyone who watches it. One cached list serves all 500k watchers.

Separately, **large fan-out jobs must not block small ones.** A 500k-recipient job sitting in a partition starves the ordinary notifications queued behind it. So I'd chunk big jobs into sub-tasks of bounded size, or route them to a separate low-priority lane. An @mention must never wait behind a viral repo.

@note · Playbook 10.1, phase 5
Name the pattern — bulkhead, circuit breaker, leaky bucket — and then say what it protects against in this system. "Preferences at delivery time" is a small detail with a real product consequence, which is precisely what depth means.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
At 10x, **fan-out worker throughput** and **per-provider rate limits** break first. The store scales linearly because it's partitioned by `user_id`.

What I'd change:

1. **Split topics by urgency.** Mentions and review requests go on a small, latency-sensitive topic with its own fan-out pool; watch activity goes on a large topic that's allowed to lag. Priority isolation becomes part of the topology.
2. **Lower the read-time merge threshold**, and chunk mid-size audiences into bounded tasks.
3. **Stretch collapse windows under backlog.** When lag rises, low-priority types collapse over longer windows, so a storm produces one summary rather than a flood.
4. **A mail router** across several providers and warmed IP pools, with per-destination-domain throttles, so one provider throttling us shifts traffic instead of filling the DLQ.

@interviewer
How would you add SMS, or Slack?

@you
A new consumer on `delivery.jobs`, a new preference field, and its own bulkhead. Nothing upstream changes. That's the payoff of making fan-out produce channel-agnostic jobs.

@interviewer
And after a consumer outage — how do you backfill?

@you
Reset the consumer group's offset to before the outage and reprocess. The idempotent writes make it safe, and the delivery log stops re-sends of anything that already went out. It's the same mechanism as recovering from a bad deploy, which is why I'd rehearse it.

@you
What I'd monitor: **Kafka consumer lag**, the leading indicator for everything, because it rises before anyone notices a late notification; **DLQ depth**, as a page; per-provider success rate and latency, so a degrading provider is visible before its breaker opens; fan-out error rate; and end-to-end p99 from event emitted to in-app delivery, which is the number users actually feel.

Unread counts deserve a word: a Redis counter with atomic `INCR` and `DECR` will drift — missed decrements, races with read-all. I'd run a periodic reconciliation against the store and accept the drift, because the failure mode is a badge showing 3 instead of 2.

@you
To close: an event log with replay, a fan-out service that writes idempotently on `(user_id, event_id)`, and delivery workers bulkheaded per provider with backoff, circuit breakers and an alerting DLQ. Preferences are checked at delivery time, and bursts become digests before they reach a provider. The design assumes every provider will fail and that the fan-out consumer will ship a bug, and it recovers from both without losing or doubling anything visible.

@note · Playbook 10.5
The close restates the hard part — unreliable providers — and lists how the design survives it. "Assumes the consumer will ship a bug" is the operational maturity signal: you designed recovery, not just the happy path.
