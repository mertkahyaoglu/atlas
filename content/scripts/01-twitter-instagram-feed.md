# Twitter / Instagram Feed — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design the home timeline for something like Twitter or Instagram.

@you
Let me pin down what "the feed" means before I draw anything, because it can mean five different products.

1. What's in: posting, following, and the home timeline — and do we also need a user's own profile timeline?
2. Is the home timeline reverse-chronological, or ranked?
3. Posts are text plus optional media, I assume — photos and video?
4. How stale is acceptable? If I post, do my followers need to see it instantly, or within a few seconds?

@interviewer
Post, follow, home timeline and profile timeline. Reverse-chronological for now — we might ask about ranking later. Text plus media. A few seconds of staleness is fine.

@you
Then here's what I'm building, and what I'm not.

**Functional:** post text with optional media; follow and unfollow; view my home timeline, which is posts from people I follow, newest first; and view any user's profile timeline.

**Non-functional:** this is read-heavy, and I'll assume roughly 100:1 reads to writes. Home timeline p99 under 200ms. **Availability over consistency** — a timeline that's five seconds stale is invisible to a user, a timeline that fails to load is not. Posts should appear in followers' feeds within a few seconds, eventually consistent.

**Out of scope, deliberately:** DMs, search, ML ranking, ads and notifications. Ranking is the one I'd expect to come back to, so I'll keep the design shaped so it can be added.

@interviewer
Fine. How big?

@you
I'll put numbers on it, because one of them decides the whole design.

@note · Playbook 10.1, phase 1
"Availability over consistency" said with a concrete example — five seconds stale versus a failed load — is worth more than the bare phrase. And naming ranking as a deliberate cut, with a promise that the shape will allow it, sets up a follow-up you already know is coming.

## Estimate · 3 min · Numbers, and the one that forces the hybrid

@you
Assumptions, tell me if any are off: 300M daily actives.

- **Posts:** 50M a day is ~500/sec, and ~1,500/sec at a 3x peak.
- **Timeline reads:** if a user opens their feed forty-odd times a day, that's ~150,000 reads/sec. So the 100:1 skew is real.
- **Post storage:** ~300 bytes a row, so ~15 GB a day of posts. Small. Media goes to blob storage, not here.
- **Followers:** ~200 on average, but the tail goes to 100M for the largest accounts.
- **Feed rows:** if every post is copied into every follower's timeline, 50M × 200 is **10 billion timeline writes a day**, at ~50 bytes each — ~500 GB a day of references.

That last line is the conclusion. **10B feed writes a day is the whole problem.** The 100:1 read skew tells me to precompute timelines, and the 100M-follower tail tells me I can't precompute them for everyone. That tension is what forces a hybrid, and it's where I want to spend the deep dive.

@interviewer
500 GB a day of references sounds like it grows forever.

@you
It would, so I cap each timeline at around 800 to 1,000 references — nobody scrolls further than that. Then the timeline store is bounded by users × cap, not by time: 300M users × 800 refs × ~50 bytes is ~12 TB. The daily write volume stays high, but storage stops growing. Anything older than the cap comes from the author's own posts if someone genuinely scrolls that far.

@note · Playbook 10.1, phase 2
Every number here produced a decision: the read skew says precompute, the follower tail says not for everyone, and the growth question says cap the list. An estimate that doesn't change a decision is three minutes wasted.

## API and data model · 5 min · Two directions of one graph, and references instead of bodies

@you
Five endpoints:

- `POST /v1/posts {text, media_ids}` → `201 post_id`. Media is uploaded separately first, so the post call stays small.
- `GET /v1/timeline/home?cursor=&limit=50` — the home feed.
- `GET /v1/users/{id}/posts?cursor=&limit=50` — a profile timeline.
- `POST /v1/users/{id}/follow` and `DELETE /v1/users/{id}/follow`, both `204`.

Pagination is a **cursor on `post_id`**, not an offset. New posts arrive at the top of the feed constantly, so page two by offset would repeat or skip items. And because post IDs are Snowflakes, which are time-sortable, the ID itself is the cursor — "give me 50 older than this one."

@you · at the whiteboard
Five tables, and each one has a key that's an argument:

| Table | Key | The point |
|---|---|---|
| `posts` | PK `post_id` (Snowflake) | `author_id`, `text`, `media_urls`, `created_at` — time-sortable ID, no separate timestamp index |
| `social_graph` | PK `follower_id`, SK `followee_id` | who *I* follow — the UI's question |
| `social_graph_reverse` | PK `followee_id`, SK `follower_id` | who follows *me* — fan-out's question |
| `user_timeline` | PK `user_id`, SK `post_id DESC` | the precomputed feed: `post_id`, `author_id`, **references only** |
| `users` | PK `user_id` | `follower_count`, `is_celebrity` derived from it |

@interviewer
Why store the graph twice?

@you
Because it's one piece of data with two access patterns. The profile page asks "who does X follow"; fan-out asks "who follows X", for every single post. In a wide-column store each of those should be a single-partition read, so I denormalize into two tables and write both on follow. The cost is keeping them in sync, and a follow is rare enough that a small async repair job is fine.

@interviewer
And why references in the timeline rather than the whole post?

@you
Three reasons. A reference is ~50 bytes instead of a full post, so 10B rows a day stays affordable. An edit or a delete touches one row in `posts` instead of millions of timeline copies. And the timeline read becomes a single-partition scan on a sorted key — about a millisecond — followed by a batched hydration from `posts`, which is cacheable because post bodies barely change.

@note · Playbook 10.1, phase 3
"Same data, two access patterns, two tables" is the sentence that shows you matched storage to access pattern rather than to entity. Saying *why* the timeline holds references pre-empts the delete question before the interviewer asks it.

## High-level design · 10 min · The write path fills two stores, the read path merges them

@you · drawing
A write path and a read path behind one API gateway, and they never call each other. Let me trace a post first.

1. `POST /posts` hits the **API gateway** — auth, rate limiting — and reaches the **Post Service**.
2. The Post Service writes the post to the **posts store in Cassandra** and publishes `post.created` to **Kafka**. Then it returns `201`. It does not wait for fan-out.
3. The **fan-out service**, a Kafka consumer group, reads the event and checks one thing: does the author have more than ~100k followers?
4. **Ordinary author:** page through `social_graph_reverse` and write one reference row per follower into `user_timeline`, in batches.
5. **Celebrity:** skip eager fan-out entirely. The post goes into a **Redis celebrity cache** — that author's recent-posts list.

@you
Now the read, which is the path that runs 150,000 times a second.

1. `GET /timeline` reaches the **Timeline Service**, which checks Redis for an **assembled timeline**, cached for 30 seconds.
2. On a miss, it reads the user's `user_timeline` partition — cheap, one sorted scan.
3. Separately, it fetches recent posts from the handful of celebrities this user follows, from the celebrity cache.
4. Merge the two lists by `post_id` descending, drop anything deleted, hydrate the bodies, take 50, and cache the page for 30 seconds.

Media never goes through either path. The response carries URLs, and the client pulls the bytes from **blob storage behind a CDN**.

@interviewer
Kafka is at-least-once. What happens when the same post is fanned out twice?

@you
Nothing, by construction. The timeline row's key is `(user_id, post_id)`, so a duplicate write is an overwrite of an identical row. I'd rather make the consumer idempotent through the key than try to get exactly-once out of the pipeline — that doesn't exist across system boundaries, and the key makes it unnecessary.

@interviewer
Why precompute at all? Just read the follow list and pull recent posts from each author.

@you
That's fan-out on read, and it's the right answer for a small product. Here it means every one of 150,000 reads a second scatter-gathers across ~200 authors, sorts, and merges — so the expensive work sits on the frequent operation. Fan-out on write moves that work to the rare operation, the post, and turns the read into one partition scan. With a 100:1 skew, that's the trade I want.

But — and this is the deep dive — it only holds for the median author.

@note · Playbook 10.1, phase 4
Two flows, traced separately, with the claim that they never call each other. And when the interviewer proposes the simpler alternative, don't dismiss it: say where it's correct, then name the number that rules it out here.

## Deep dive · 15 min · The celebrity problem and the hybrid

@you
I think the interesting part is the celebrity problem — how fan-out behaves when one post reaches 100M people. The other candidate is the read path: the cache, staleness, and hydration. Which would you rather I go deep on?

@interviewer
The celebrity problem.

@you
Fan-out cost is **bimodal**. A median user's post is 200 writes. A post from an account with 100M followers is 100M writes, and it arrives as one spike — a celebrity posting a few times a day saturates the write path by themselves. There's no amount of horizontal scaling that makes 100M writes for a single post a good idea, and meanwhile ordinary users' posts queue behind it.

So the code path splits:

| | Ordinary author | Celebrity (> threshold) |
|---|---|---|
| On post | fan out on write to every follower | write once, to their cached recent-posts list |
| On read | already in the reader's timeline | merged in at read time |
| Cost lands on | the write | the read |

@you
Why this works is the part I want to be explicit about: **the costs are inversely distributed.** A user follows *many* ordinary accounts, so precomputation pays off across all of them. They follow only a *few* celebrities, so merging a handful of cached lists at read time is cheap. We pick the cheap side of each. And a celebrity's recent-posts list is one cache entry serving 100M readers — the highest-leverage cache in the system. It's also the hottest key, so it gets replicated rather than living on one node.

The threshold — I said 100k — is a tunable, not a constant. Set it where the measured fan-out cost exceeds the measured merge cost, and expect it to differ between products.

@interviewer
An account's follower count crosses the threshold. What happens to their posts?

@you
Their old posts were fanned out, their new ones aren't, and both paths have to coexist. They do, naturally: the merge reads the precomputed rows *and* the celebrity list, and deduplicates on `post_id`. So a post that happens to exist in both places — say we flip the flag while a fan-out is mid-flight — shows once. Nothing needs migrating. The same holds going the other way, if an account drops back below.

@interviewer
What about a user who follows 50,000 accounts?

@you
Fan-out on write doesn't care — its cost is driven by the *author's* follower count, not the reader's following count. What grows is the read-time merge, because that reader probably follows hundreds of celebrities. So I cap it: merge the few dozen celebrity lists with the most recent posts, and let quieter ones surface on the next refresh of the assembled cache. At 150k reads a second, an unbounded merge is a latency bug waiting for one heavy user.

@you
Three more things on the write path that remove most of the volume.

**Active users only.** Fan out only to followers who've been active in the last ~30 days. Most registered accounts are dormant, and this can eliminate the majority of those 10B writes. A dormant user who comes back gets their timeline rebuilt at read time from the people they follow, once, and then they're back on the eager path.

**Don't fan out deletes.** A delete would be another N writes. Instead the read path filters: hydration drops any post that no longer exists, backed by a tombstone set for recent deletes. I'm trading a slightly more expensive read to avoid a huge delete fan-out.

**Late follows.** If Bob follows Alice after she posted, her recent posts aren't in his timeline. I'd backfill her last few dozen posts into his timeline on follow. It's a bounded, small job, and the alternative — a new follow that shows nothing — feels broken.

@interviewer
Retweets?

@you
A repost is a post that references the original. I fan out the repost like any other post and hydrate the original at read time, so an edit or delete of the original still applies everywhere. If three people I follow repost the same thing, the merge dedupes on the original's ID and shows it once — "reposted by Sam and 2 others."

@interviewer
How do you keep that 30-second timeline cache warm? A cold miss is an expensive merge.

@you
Two things. Pre-warm on signals that a read is coming — app open, login — so the merge runs before the user asks. And serve **stale-while-revalidate**: if the cached page has expired, return it immediately and rebuild in the background. The user never waits for a rebuild, and they already agreed a few seconds of staleness is invisible.

@note · Playbook 10.3
"This works for the median user, but it breaks down for accounts with millions of followers, so let me describe a hybrid" is the sentence this prompt exists to hear. The follow-ups on threshold crossing and heavy followers are the interviewer checking whether the two paths genuinely coexist, and the dedupe on `post_id` is the answer to both.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
What breaks first at 10x is **fan-out worker throughput**, and right behind it the raw `user_timeline` write volume — ~100B writes a day, around 3.5M a second at peak.

In order of what I'd reach for:

1. **Count active followers, not total.** A 50M-follower account with 2M daily actives should fan out like a 2M one. That removes most of the volume.
2. **Priority lanes by fan-out size.** Separate worker pools, so an ordinary user's post reaches 200 followers in seconds even while a huge post is still fanning out. Same bulkhead idea as a notification system.
3. **Capped in-memory timeline lists.** A timeline is appended to, trimmed at 800 and read whole — that's a list, and an in-memory list store beats Cassandra rows for exactly that shape. Only active users keep one; dormant users rebuild on return.
4. **Chunk follower lists** into partitions of ~10k IDs so a 500M-follower account isn't one unbounded hot partition, and workers can page it in parallel.
5. **Regions.** At 3B users a 200ms p99 can't absorb an ocean round trip, so reads serve from regional copies and fan-out runs in the follower's region.

@you
What I'd monitor: **consumer lag on `post.created`**, because that *is* "how long until my followers see my post" and it rises before anyone complains; the timeline cache hit rate and p99 of the merge; request rate on the hottest celebrity keys; and the number of celebrity lists merged per read, which tells me when the cap needs tuning.

@interviewer
Last one. How would you add ML ranking?

@you
The shape already allows it. `user_timeline` stops being the feed and becomes the **candidate set**. At read time: generate candidates from it and the celebrity lists, filter seen and blocked, score everything with a cheap model, rescore the top few hundred with an expensive one, then apply diversity rules so one author doesn't dominate. The features are precomputed and cached, because 150k reads a second can't afford to compute them inline.

What changes is the cursor. Reverse-chronological pages by `post_id`; a ranked feed has to page a snapshot of the ranked list, or the order shifts under the user as they scroll.

@you
To close: the design is fan-out on write for the median author, merge on read for the few huge ones, split at a threshold we tune by measurement. Around it, the things that keep it honest are idempotent writes keyed on `(user_id, post_id)`, cursor pagination on Snowflake IDs, and filtering deletes at read time instead of fanning them out. If I had another week, I'd spend it on the active-follower threshold and priority lanes, because that's where 10x breaks first.

@note · Playbook 10.5
Naming fan-out throughput as the first thing to break — with the metric that would show it — is the operational maturity dimension. Answering the ranking question by pointing at a shape you already built ("the timeline becomes the candidate set") shows the design was extensible, not just correct.
