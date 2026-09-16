# Video Streaming — a 45-minute round

## Clarify · 5 min · Requirements, and the scope cuts said out loud

@interviewer · the prompt
Design YouTube. Or Netflix — the video part.

@you
Those two have different centres of gravity — YouTube is dominated by uploads, Netflix by delivery — so let me scope it.

1. Do we cover both sides, creators uploading and viewers watching?
2. Uploads can be large — are we expecting multi-gigabyte files from phones on flaky connections?
3. Do we transcode into multiple qualities and adapt to the viewer's network?
4. Browse, search, recommendations, view counts — how much of that is ours?
5. Live streaming, or on-demand only?

@interviewer
Both sides. Yes, large uploads from anywhere. Multiple qualities, adaptive. Treat browse, search and recommendations as other teams' services, but view counts are yours. On-demand only.

@you
Then here's what I'm building, and what I'm not.

**Functional:** upload a video — large, and resumable over flaky connections; transcode it into multiple resolutions and bitrates; stream it with quality that adapts to network conditions; thumbnails and captions; and view counts.

**Non-functional:** playback starts in **under 2 seconds** with minimal rebuffering. Uploads **survive network interruption**. The system is extremely read-heavy and **bandwidth-dominated**. The audience is global, which means latency is physics — we have to serve from nearby.

**Out of scope, deliberately:** DRM specifics, recommendation ML, and live streaming — though I'll say at the end how live would differ, because it breaks one of the key assumptions.

@interviewer
Numbers.

@you
Yes. I think one of them explains the entire architecture.

@note · Playbook 10.1, phase 1
"Latency is physics" is a non-functional requirement that already implies a CDN. Scoping live streaming out *but promising to contrast it* signals you know which assumption it would break.

## Estimate · 3 min · The number that justifies everything

@you
- **Uploads:** ~500 hours of video every minute.
- **Views:** 5B a day, so ~60,000 playbacks starting every second.
- **Bandwidth** — and this is the real number: 5M concurrent viewers × ~5 Mbps is **25 Tbps** of egress.
- **Storage:** an hour of source is ~5 GB. Across ~6 renditions that's ~15 GB stored per hour of video. 500 hours a minute × 15 GB is ~7.5 TB a minute — **~11 PB a day**. Petabyte scale, which means tiering.

The conclusion: **25 Tbps cannot come from our origin.** No fleet of application servers, and no single data centre, pushes that. More than 95% of delivery has to be CDN, and the origin's job is to be the cache-miss backstop — nothing more. That single number justifies the whole architecture.

@interviewer
And 11 PB a day?

@you
It says we can't keep everything hot, forever, at full replication. View distribution is an extreme power law — a tiny fraction of videos get almost all the views — so most of that 11 PB is going to be watched a handful of times. That's a lifecycle policy, and it also says to be stingy about which renditions we make for which videos.

@note · Playbook 10.1, phase 2
Estimating bandwidth, not requests, is the insight. Most candidates compute QPS for this prompt; the number that designs the system is 25 Tbps, and the conclusion — "the origin is a backstop" — follows directly from it.

## API and data model · 5 min · Metadata in the database, bytes somewhere else

@you
Seven calls, and the point is which ones touch our servers:

- `POST /v1/videos {title, desc}` → `201 {video_id, upload_url}`.
- `PUT <presigned object-storage URL>` — **direct to storage**, multipart, resumable. Our servers never see it.
- `POST /v1/videos/{id}/complete {parts[]}` → `202`, which triggers processing.
- `GET /v1/videos/{id}` → metadata plus the manifest URL.
- `GET <cdn>/videos/{id}/master.m3u8` — the adaptive bitrate manifest, **from the CDN**.
- `GET <cdn>/videos/{id}/720p/seg_0042.ts` — a media segment, **from the CDN**.
- `POST /v1/videos/{id}/view` → `202`, an async view event.

@you · at the whiteboard
Four tables, and what's notable is what isn't in them:

| Table | Key | The point |
|---|---|---|
| `videos` | PK `video_id` | owner, title, duration, `status: UPLOADING \| PROCESSING \| READY \| FAILED` |
| `renditions` | PK `video_id`, SK `(resolution, codec)` | `manifest_path`, bitrate, size, `ready` |
| `jobs` | PK `job_id` | `video_id`, `stage`, `state`, `attempts` — the transcode DAG's state |
| `views_raw` | stream | Kafka → aggregation → `views_agg` |

**The video bytes are not in the database.** Metadata in the database, bytes in object storage, delivery by CDN. That split is the whole design. What we actually build is a metadata service and a transcoding pipeline.

@interviewer
What's a presigned URL buying you?

@you
If uploads flowed through our application servers, those servers would become a bandwidth bottleneck, and we'd pay for every byte twice — in and out. A presigned URL is a **time-limited, permission-scoped credential** that lets the client write one object directly to storage. Our service authorizes the upload, then gets out of the way. It's the same idea in reverse for playback: never proxy bytes.

@note · Playbook 10.1, phase 3
Annotating each endpoint with *where the bytes go* makes the hard part visible in the API itself. "What is *not* in the database" is a stronger sentence than listing what is.

## High-level design · 10 min · Upload, transcode, deliver

@you · drawing
Three stages. Upload first.

1. The creator posts **metadata only** to the **upload service**.
2. It returns a **presigned multipart URL**.
3. The creator uploads **directly to object storage** under `raw/`, in parts.

A 5 GB file over mobile will fail at some point, so **multipart** matters: the file is split into parts uploaded independently, a failed part is retried alone rather than restarting from zero, and the client gets parallelism for free. Resuming is just asking storage which parts it already has and sending the missing ones.

@you
Then processing. The completed upload emits `video.uploaded` to Kafka, and an **orchestrator** runs the transcode as a **DAG**:

1. **Inspect** the codec, duration and tracks.
2. **Split** into ~10-second chunks, on keyframe boundaries.
3. **Transcode** each chunk into each rendition — 240p up to 4K, H.264 and AV1.
4. **Side jobs** in parallel: thumbnails, audio, captions, moderation.
5. **Package** HLS and DASH segments plus a master manifest.

Output lands in `processed/`, and the video's status becomes `READY`.

@you
And delivery. The **player** fetches the manifest and segments from a **CDN edge** near the viewer. On a miss, the edge pulls from the **origin**, which reads `processed/`. The edges serve over 95% of bytes. The player picks each next segment's quality from its measured throughput and buffer, and sends view events asynchronously.

@interviewer
Why split into chunks before transcoding?

@you
Parallelism. Transcoding a two-hour film serially takes hours. Split into ~10-second chunks, and a thousand workers can transcode in parallel — wall-clock time drops to minutes. It also makes failure cheap: a crashed worker loses ten seconds of work, not the whole job. It's MapReduce applied to video.

The detail that makes it work: chunks must split on **keyframe boundaries**. Otherwise a chunk starts with frames that reference frames in the previous chunk, it won't decode independently, and the pieces won't reassemble cleanly.

@interviewer
What compute runs the transcoding?

@you
**Spot or preemptible instances.** Transcoding is batch, idempotent, retryable, and not latency-sensitive — a creator waits minutes either way. That's exactly the profile spot capacity is for, at a large discount. And because a chunk is ten seconds of work, losing a spot instance mid-job costs almost nothing.

@interviewer
View counts — just increment a column?

@you
5B a day of `UPDATE videos SET views = views + 1` would melt any database, and a popular video's row becomes the hottest row in the system. Instead, each view is an event to Kafka, a stream processor aggregates over tumbling windows, and periodic aggregates get written. The displayed count is approximate and a few seconds behind — and I'd say plainly that's fine, rather than try to make it exact.

@note · Playbook 10.1, phase 4
Three stages, each with a one-sentence reason — multipart for flaky networks, chunks for parallelism, CDN for 25 Tbps. The keyframe detail is the one-level-deeper answer that shows you know why chunking works, not just that it does.

## Deep dive · 15 min · Adaptive bitrate and the CDN, or the pipeline under failure

@you
Two parts I could go deep on: playback — adaptive bitrate and how the CDN is actually used — or the transcoding pipeline under failure and cost. Which is more interesting to you?

@interviewer
Playback first.

@you
Adaptive bitrate, properly. The video is encoded at several quality levels, and each level is cut into **aligned segments** — segment 42 covers the same seconds at 240p and at 1080p. A **manifest** lists the levels and their segments. The player measures its download throughput and how many seconds it has buffered, and picks the quality of the *next* segment. Because segments are aligned and independently decodable, it can switch between them mid-playback without a glitch.

The asymmetry is the interesting part: players **step down aggressively and step up conservatively.** A rebuffer — the spinner — damages perceived quality far more than a few seconds of lower resolution. So when the buffer drains, drop a level immediately; when throughput looks good, wait until it's been good for a while before climbing. That's a product-informed engineering decision, and it's also why start time is under two seconds: start at a conservative quality and climb.

@interviewer
HLS or DASH?

@you
HLS is Apple's and supported everywhere; DASH is the open, codec-agnostic standard. Real services ship both, or use **CMAF** so one set of segments serves both manifests and we don't store everything twice. I wouldn't spend longer than that on it.

@you
Now the CDN strategy. Two modes:

- **Push** popular content to edges proactively, before demand. A new season release is predictable — we know when a million people will press play.
- **Pull** for the long tail: an edge fetches on first request and caches it.

And at the far end of "put the data near the user" is what Netflix does with Open Connect: cache appliances placed **inside ISPs' networks**, so bytes never cross the public backbone at all. At 25 Tbps with a commercial CDN, I'd start there; at 10x it becomes the economics of the business.

@interviewer
A video goes viral in one region. What happens to the origin?

@you
The CDN absorbs the views — that's the point. The risk is the first wave: a hundred edges all missing at the same moment means a hundred origin fetches for the same segment. So I'd add an **origin shield** — a mid-tier regional cache between the edges and the origin — so a hundred edge misses become one origin fetch.

@interviewer
Transcoding fails halfway. What happens?

@you
The DAG tracks state **per chunk**, so we retry failed chunks only — not the video. Retries are safe because a transcode is idempotent: same input chunk, same output object key.

And if a rendition genuinely can't be produced — say AV1 at 4K keeps failing on a weird source — **publish with the renditions that succeeded and backfill the rest.** Availability of *some* quality beats blocking the whole video. The `renditions` table's `ready` flag is what the manifest is generated from, so a missing rendition just isn't listed.

@interviewer
4K and HDR?

@you
More renditions, bigger segments, and a codec decision. AV1 compresses much better than H.264 — meaningfully less bandwidth for the same quality — but costs far more CPU to encode. That's a classic compute-versus-bandwidth trade, and the answer depends on how many times the video will be watched: encoding cost is paid once, bandwidth is paid per view.

@you
Which leads to storage tiering. View distribution is an extreme power law, so hot content stays in standard storage and on CDN, and **lifecycle policies** move cold content to infrequent-access and archive tiers automatically. I'd also store **fewer renditions for cold content** — if a five-year-old video suddenly trends, re-transcode it from the original on demand.

@interviewer
Copyright detection?

@you
Compute perceptual fingerprints of the audio and video during the pipeline and match against a reference index. It's expensive, so it runs as a separate stage that can finish **after publishing**, flagging retroactively. Blocking every upload on it would delay every creator for the sake of a small fraction of videos.

@note · Playbook 10.1, phase 5
"Step down aggressively, up conservatively" is the ABR detail that shows product sense. The AV1 answer turns into "encoding is paid once, bandwidth per view" — a trade-off with a variable in it, which is stronger than naming a codec.

## Bottlenecks and wrap · 5 min · What breaks first, and what I'd watch

@you
At 10x — 250 Tbps, 5,000 hours uploaded a minute — the first thing that breaks is **cost**, not capacity.

1. **CDN egress** becomes the dominant cost of the business, so the edge moves **inside ISPs**, with appliances **filled overnight** by predicted popularity and a **steering service** choosing an appliance per session by health, load and what it holds.
2. **Origin shields** become mandatory, because a release's first wave across thousands of appliances would flatten the origin.
3. **Transcoding compute.** AV1 at a full ladder for everything never pays back for videos nobody watches, so a **popularity predictor** decides: likely hits get the full ladder in AV1 and H.264, the long tail gets a few H.264 renditions and is re-encoded if it trends.
4. **Storage**: erasure coding instead of 3x replication, originals to archive, cold renditions deleted and regenerated on demand.

@interviewer
"Continue watching" — where does playback position live?

@you
Small, high-frequency writes keyed by `(user_id, video_id)`. I'd batch them on the client — every ten seconds, plus on pause and exit — rather than every second. Losing the last few seconds of position on a crash is invisible; a write every second from 5M viewers isn't.

@interviewer
And live streaming — what changes?

@you
Chunking and ABR stay. But transcoding has to happen **in real time** with a budget of seconds, and there's no batch parallelism, because chunks arrive as they're recorded — you can't fan a two-hour live stream out to a thousand workers. You need low-latency protocols, LL-HLS or WebRTC, and origin shields to protect against the thundering herd when a big stream starts and everyone joins in the same second.

@you
What I'd monitor: **playback start time** and **rebuffer ratio**, which are what viewers actually feel; CDN cache hit ratio and origin egress, because a falling hit ratio is both a latency and a cost problem; transcode queue depth and time-to-`READY` per video; spot preemption rate; and per-rendition failure rates, which catch a bad encoder release before creators do.

@you
To close: our servers handle metadata and authorization, and never bytes. Uploads go direct to storage, multipart and resumable. Transcoding is a DAG over keyframe-aligned chunks on spot compute. Delivery is CDN-first with the origin as a backstop, and the player adapts quality segment by segment. The estimate made the case — 25 Tbps can't come from us — and everything else follows from taking that seriously.

@note · Playbook 10.5
"What breaks first is cost" is a senior answer on this prompt, and it's backed by the same bandwidth number from the estimate. Closing by pointing back at that number shows the design was derived, not recalled.
