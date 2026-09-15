---
group: "design"
order: 8
title: "Video Streaming"
summary: "Upload, transcode and deliver video at twenty-five terabits per second of egress."
hardPart: "Video bytes never touch your application servers — not on upload, not on playback. What you actually build is a metadata service and a transcoding pipeline."
tags: ["object-storage", "cdn", "chunking", "stream-processing"]
hardPartDetail: "Understanding that video bytes never touch your application servers — not on upload, not on playback. Everything is object storage and CDN. The system you actually build is a metadata service plus a transcoding pipeline."
concepts:
  - "object storage"
  - "presigned/resumable uploads"
  - "batch transcoding pipeline"
  - "CDN strategy"
  - "adaptive bitrate streaming"
  - "chunking"
  - "DAG-based job orchestration"
  - "metadata vs bytes separation"
requirements:
  functional:
    - "Upload a video (large files, resumable over flaky connections)"
    - "Transcode to multiple resolutions and bitrates"
    - "Stream with adaptive quality based on network conditions"
    - "Browse, search, view counts, recommendations (treat as separate services)"
    - "Thumbnails, captions/subtitles"
  nonFunctional:
    - "Playback start time < 2s, minimal rebuffering"
    - "Upload must survive network interruption"
    - "Extremely read-heavy and bandwidth-dominated"
    - "Global audience → latency is physics, must serve from nearby"
  outOfScope: "DRM specifics, recommendation ML, live streaming (mention how it differs)."
scale:
  numbers: |-
    Uploads:     500 hours of video/minute
    Views:       5B/day → ~60,000 concurrent streams/sec initiated
    Bandwidth:   this is the real number —
                 5M concurrent viewers × 5 Mbps = 25 Tbps
    Storage:     1 hour of source ≈ 5 GB; × ~6 renditions ≈ 15 GB stored
                 500 hr/min × 15 GB = huge → petabyte scale, tiered
  conclusion: "25 Tbps cannot come from your origin. **>95% of delivery must be CDN.** Your origin's job is to be the cache-miss backstop, nothing more. This single number justifies the entire architecture."
tradeoffs:
  - title: "Presigned URLs, and why they matter"
    body: |-
      If uploads route through your application servers, those servers become a bandwidth bottleneck and you pay for the traffic twice. A presigned URL is a time-limited, permission-scoped credential that lets the client write directly to object storage. Your service authorizes, then gets out of the way. Same idea in reverse for playback: never proxy bytes.
  - title: "Multipart upload"
    body: |-
      A 5 GB upload over a mobile connection will fail. Multipart splits it into parts uploaded independently; a failed part is retried alone rather than restarting from zero. The client also gets parallelism. This is table stakes for any large-file system, not a video-specific trick.
  - title: "Why chunk before transcoding"
    body: |-
      Transcoding a 2-hour film serially takes hours. Splitting into ~10-second chunks lets 1,000 workers transcode in parallel, cutting wall-clock time to minutes. It also makes failure cheap: a crashed worker loses 10 seconds of work, not the whole job. This is MapReduce applied to video, and the parallelism argument is the main insight the interviewer wants.

      Chunks must split on **keyframe boundaries**, or the pieces won't decode independently and won't reassemble cleanly. Good detail to drop.
  - title: "Spot instances are the right compute"
    body: |-
      Transcoding is batch, idempotent, retryable, and not latency-sensitive. That profile is exactly what preemptible/spot capacity is for, at a large discount. Saying this shows cost awareness, which senior interviews do reward.
  - title: "Adaptive bitrate (ABR), explained properly"
    body: |-
      The video is encoded at several quality levels, each cut into aligned segments. A manifest lists them. The player measures throughput and buffer depth and picks the next segment's quality. Because segments are aligned and independently decodable, it can switch mid-playback without interrupting.

      The asymmetry worth mentioning: players step **down aggressively and up conservatively**, because a rebuffer is far more damaging to perceived quality than a few seconds of lower resolution. That's a product-informed engineering decision.
  - title: "HLS vs DASH"
    body: |-
      HLS is Apple's, universally supported, historically `.ts` segments. DASH is the open standard, codec-agnostic. Real services ship both, or use CMAF so one set of segments serves both. Know the names; don't spend time here.
  - title: "CDN strategy"
    body: |-
      Push popular content proactively to edges before demand (a new season release is predictable); pull for the long tail. Netflix goes further with Open Connect — appliances placed inside ISP networks, so bytes never cross the public internet backbone. Mention it as the logical endpoint of "put the data near the user."
  - title: "Storage tiering"
    body: |-
      View distribution is extreme power-law: a tiny fraction of videos get almost all views. Keep hot content in standard storage and on CDN, move cold content to infrequent-access or archive tiers automatically via lifecycle policies. Also consider storing fewer renditions for cold content — you can re-transcode on demand if a five-year-old video suddenly trends.
  - title: "View counts are not a database increment"
    body: |-
      5B/day of `UPDATE videos SET views = views + 1` would melt any database, and every view is a hot row on a popular video. Instead: fire an event to Kafka, aggregate in a stream processor over tumbling windows, and write periodic aggregates. The displayed count is approximate and delayed by seconds. That's fine, and saying it's fine (rather than trying to make it exact) is the correct answer.
  - title: "Live streaming differs"
    body: |-
      Same chunking and ABR, but transcoding must happen in real time with a latency budget of seconds, there's no batch parallelism (chunks arrive as they're recorded), and you need low-latency protocols (LL-HLS, WebRTC) plus origin-shield layers to protect against thundering herds when a stream starts.
followUps:
  - question: "How do you resume an interrupted upload?"
    answer: "Client asks which parts the server already has, uploads only the missing ones, then calls complete. Object storage tracks parts natively."
  - question: "How do you detect copyrighted content?"
    answer: "Compute perceptual fingerprints of audio and video during the pipeline and match against a reference index. It's a separate, expensive stage that can run asynchronously after publishing, flagging retroactively."
  - question: "A video goes viral in one region."
    answer: "The CDN absorbs it — that's the point. If the origin sees a spike of cache misses, add an origin shield (a mid-tier cache between edges and origin) so 100 edges produce one origin fetch instead of 100."
  - question: "How do you handle 4K/HDR?"
    answer: "More renditions, larger segments, and a codec decision (AV1 gives much better compression than H.264 but costs far more CPU to encode — a classic compute-vs-bandwidth trade you can spell out)."
  - question: "What's the failure mode if transcoding fails halfway?"
    answer: "The DAG tracks per-chunk state; retry failed chunks only. If a rendition can't be produced, publish with the renditions that succeeded and backfill — availability of *some* quality beats blocking the whole video."
  - question: "How do you do per-user resume (\"continue watching\")?"
    answer: "Small, high-frequency writes of playback position keyed by (user, video). Batch them client-side (every 10s, plus on pause/exit) rather than every second."
---
# 08 — Video Streaming (YouTube / Netflix)

## API / Model

```api
POST /v1/videos || {title, desc} || 201 {video_id, upload_url}
PUT <presigned S3 url> || || 200 || direct, multipart, resumable
POST /v1/videos/{id}/complete || {parts[]} || 202 || triggers the processing pipeline
GET /v1/videos/{id} || || 200 metadata + manifest URL
GET <cdn>/videos/{id}/master.m3u8 || || 200 ABR manifest
GET <cdn>/videos/{id}/720p/seg_0042.ts || || 200 media segment
POST /v1/videos/{id}/view || || 202 || async view event
```

```schema
videos || PK: video_id || owner, title, description, duration, status, created_at || status: UPLOADING | PROCESSING | READY | FAILED
renditions || PK: video_id SK: (resolution, codec) || manifest_path, bitrate, size, ready ||
jobs || PK: job_id || video_id, stage, state, attempts || transcode DAG state
views_raw || || Kafka → stream aggregation → views_agg ||
```

Note what is *not* in the database: the video bytes. Metadata in the database, bytes in object storage, delivery via CDN. That split is the whole design.

---

## High-level architecture

<!-- tab: Today · 25 Tbps -->

```mermaid
flowchart TB
    Creator([Creator]) -- "1 · POST metadata only" --> UploadSvc[Upload Service]
    UploadSvc -- "2 · presigned multipart URL" --> Creator
    Creator -- "3 · uploads DIRECTLY<br/>bytes never touch app servers" --> Raw

    Raw[("Object storage · raw/<br/>multipart, chunked, resumable")]
    Raw -- "completion event" --> Bus{{"Kafka · video.uploaded"}}
    Bus --> Orch

    subgraph PIPE ["Transcoding pipeline · a DAG"]
        direction TB
        Orch[Orchestrator<br/>job DAG state machine]
        Inspect["1 · inspect codec, duration, tracks"]
        Split["2 · split into ~10s chunks<br/>on KEYFRAME boundaries<br/>this is what makes it parallel"]
        Transcode["3 · transcode each chunk × each rendition<br/>240p…4K · H.264 + AV1<br/>on spot instances: batch, idempotent, retryable"]
        Side["4 · parallel side jobs<br/>thumbnails · audio · captions · moderation"]
        Package["5 · package HLS / DASH segments<br/>+ master manifest"]
        Orch --> Inspect --> Split --> Transcode --> Side --> Package
    end

    Package --> Processed[("Object storage · processed/<br/>status = READY")]
    Processed --> Origin[Origin<br/>serves CDN misses only]

    subgraph CDN ["CDN edges · over 95% of all bytes"]
        direction LR
        Edge1[London]
        Edge2[Tokyo]
        Edge3[São Paulo]
    end

    Origin -- "pull on miss · under 5%" --> Edge1
    Origin --> Edge2
    Origin --> Edge3

    Edge1 --> Player
    Edge2 --> Player
    Edge3 --> Player

    Player["Player · adaptive bitrate<br/>measures throughput + buffer<br/>steps DOWN aggressively,<br/>UP conservatively"]
    Player -. "view events · async" .-> Views{{"Kafka → Flink<br/>view counts, watch time, QoE"}}

    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef external fill:#2f5a4d,stroke:#5cc98f,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    class Raw,Processed blob
    class Split hot
    class Bus,Views queue
    class Edge1,Edge2,Edge3 external

    click Raw href "/docs/09-specialized-building-blocks" "Role: receives original uploads directly, multipart and resumable.<br/>Trade-off: keeping originals costs storage, but allows re-transcoding later."
    click Bus href "/docs/05-async-messaging-and-event-driven" "Role: an upload event starts the transcoding pipeline asynchronously.<br/>Trade-off: a video isn't watchable until processing finishes."
    click Processed href "/docs/09-specialized-building-blocks" "Role: holds the renditions and segments the CDN pulls from.<br/>Trade-off: several copies per video multiply storage cost."
    click Views href "/docs/05-async-messaging-and-event-driven" "Role: counts views and playback quality without slowing playback.<br/>Trade-off: counts are approximate and arrive late."
```

Metadata and bytes take different routes. The Upload Service handles only metadata and upload URLs, while the video itself goes from the creator to object storage, through a transcoding DAG, and out to viewers from CDN edges.

1. The creator posts the video's metadata, and nothing else, to the Upload Service.
2. The Upload Service returns a presigned multipart URL.
3. The creator uploads the file directly to object storage under `raw/`, in parts that can each be retried and resumed.
4. The completed upload emits an event to Kafka `video.uploaded`, and the Orchestrator runs the transcoding pipeline as a job DAG state machine:
   1. Inspect the codec, duration and tracks.
   2. Split the source into chunks of about 10 seconds on keyframe boundaries.
   3. Transcode each chunk into each rendition, from 240p to 4K in H.264 and AV1, on spot instances.
   4. Run the side jobs: thumbnails, audio, captions and moderation.
   5. Package HLS / DASH segments and a master manifest.
5. The packaged output is written to object storage under `processed/`, and the video's status becomes `READY`.

Playback runs the other way, and it doesn't touch the app servers either. The player requests segments from a CDN edge such as London, Tokyo or São Paulo, and the edges serve over 95% of all bytes. On a miss, an edge pulls the segment from the Origin, which exists only to serve those misses from `processed/`. The player measures throughput and buffer depth to choose the bitrate of each next segment, and sends view events asynchronously to Kafka and Flink for view counts, watch time and QoE.

<!-- tab: At 10x · 250 Tbps -->

```mermaid
flowchart TB
    Creator([Creator]) -- "presigned multipart<br/>to the nearest region" --> Raw[("Object storage · raw/<br/>originals move to an archive tier")]
    Raw -- "completion event" --> Bus{{"Kafka · video.uploaded"}}
    Bus --> Predict["Popularity predictor<br/>creator history · early views"]
    Predict --> Orch

    subgraph PIPE ["Transcoding · spot capacity in several regions"]
        direction TB
        Orch["Orchestrator · job DAG<br/>priority lanes"]
        Ladder{"expected views?"}
        Cheap["Long tail<br/>H.264 · 3 renditions<br/>re-encoded if it trends"]
        Full["Popular<br/>AV1 + H.264 · full ladder<br/>encode cost repaid in bandwidth"]
        Package["Chunk on keyframes · transcode<br/>package via CMAF · manifest"]
        Orch --> Ladder
        Ladder -- "low" --> Cheap --> Package
        Ladder -- "high" --> Full --> Package
    end

    Package --> Processed[("Object storage · processed/<br/>erasure-coded<br/>cold renditions deleted")]
    Processed --> Shield["Origin shield · per region<br/>many edge misses → one fetch"]
    Shield --> A1 & A2 & A3

    subgraph ISP ["Cache appliances inside ISP networks"]
        direction LR
        A1[Mumbai ISP]
        A2[Lagos ISP]
        A3[Chicago ISP]
    end

    Fill["Overnight fill<br/>push tomorrow's predicted hits<br/>during off-peak hours"] -.-> A1 & A2 & A3
    Steer["Steering service<br/>picks an appliance per session<br/>by health, load and contents"] --> Player
    A1 & A2 & A3 --> Player

    Player["Player · adaptive bitrate<br/>steps DOWN aggressively,<br/>UP conservatively"]
    Player -. "view + QoE events · async" .-> Views{{"Kafka → Flink<br/>view counts · sampled QoE"}}

    classDef blob fill:#5f5830,stroke:#e6c43c,color:#d7dee8
    classDef queue fill:#4b4771,stroke:#ad94f7,color:#d7dee8
    classDef hot stroke:#e8a33d,stroke-width:2px
    classDef scaled stroke-dasharray:5 3
    class Raw,Processed blob
    class Bus,Views queue
    class Ladder hot
    class Predict,Ladder,Cheap,Full,Processed,Shield,A1,A2,A3,Fill,Steer scaled

    click Predict href "/docs/09-specialized-building-blocks" "Role: estimates how many views a new upload will get, from creator history and early views.<br/>Trade-off: a surprise hit starts on the cheap ladder until it's re-encoded."
    click Ladder href "/docs/09-specialized-building-blocks" "Role: picks the encoding ladder each video is worth.<br/>Trade-off: two ladders to maintain, plus re-encoding work when predictions miss."
    click Processed href "/docs/09-specialized-building-blocks" "Role: renditions stored with erasure coding; renditions of cold videos are deleted.<br/>Trade-off: a cold video that trends again is regenerated from its archived original."
    click Shield href "/docs/04-caching" "Role: collapses many edge misses into one origin fetch per segment.<br/>Trade-off: another cache tier to size and keep healthy."
    click A1 href "/docs/09-specialized-building-blocks" "Role: cache appliances inside ISP networks, serving viewers from next door.<br/>Trade-off: hardware to ship, host and replace at thousands of partner sites."
    click Fill href "/docs/04-caching" "Role: pushes predicted popular titles to appliances during off-peak hours.<br/>Trade-off: wrong predictions waste scarce appliance disk."
    click Steer href "/docs/01-foundations" "Role: picks an appliance per playback session by health, load and what it holds.<br/>Trade-off: one more call before playback starts, so it must stay very fast."
    click Views href "/docs/05-async-messaging-and-event-driven" "Role: counts views and samples playback quality without slowing playback.<br/>Trade-off: counts are approximate and arrive late."
```

Same product at 10x. At 100x the service would push 2.5 Pbps of video, which stops being a system design and becomes a telecom build-out, so this tab uses 10x. Dashed outlines mark what's new or reshaped compared with today's design.

| | Today | At 10x |
|---|---|---|
| Upload rate | 500 hours/min | 5,000 hours/min |
| Concurrent viewers | 5M | 50M |
| Egress | 25 Tbps | 250 Tbps |
| New stored video, ~15 GB per hour | ~11 PB/day | ~110 PB/day |

**What changes, and the number that forces it**

1. **The edge moves inside ISPs.** At 250 Tbps, paying a commercial CDN per gigabyte becomes the dominant cost of the business. Cache appliances are placed inside ISP networks, which host them happily because the traffic no longer crosses their own transit links. Bytes travel from a box in the viewer's ISP, never across the backbone. It's the Open Connect endpoint that today's CDN trade-off already points at.
2. **Appliances are filled overnight, by prediction.** Appliance disks are limited, and pulling every miss during prime time hammers the shield. A fill job pushes tomorrow's predicted popular titles into each appliance during off-peak hours, while the long tail still pulls on miss.
3. **A steering service chooses the edge.** DNS-based routing can't tell that an appliance is full, unhealthy or missing a title. The player asks a steering service, which picks an appliance for each session by health, load and what that appliance actually holds.
4. **An origin shield tier becomes mandatory.** With thousands of appliances, a new release's first wave of misses would multiply into origin fetches. A regional shield collapses them, so many edges produce one origin fetch per segment, as the viral-video follow-up describes.
5. **The encoding ladder depends on expected views.** AV1 saves a lot of bandwidth but costs far more CPU to encode. At 5,000 hours uploaded per minute, encoding everything in AV1 at a full ladder is a compute bill that never pays back for videos nobody watches. A popularity predictor decides: likely hits get AV1 plus H.264 at the full ladder, and the long tail gets H.264 at a few renditions, re-encoded if it starts to trend.
6. **Storage is erasure-coded and pruned.** ~110 PB/day of new renditions can't be kept at 3x replication. Processed renditions are erasure-coded, originals move to an archive tier, and the renditions of videos that went cold are deleted and regenerated from the original on demand.

**What stays the same**

Video bytes never touch the application servers. Uploads are still presigned, multipart and resumable, transcoding is still chunked on keyframes and run on spot capacity, players still step down fast and up slowly, and view counts still come from a stream aggregation rather than database increments.

<!-- /tabs -->

---
