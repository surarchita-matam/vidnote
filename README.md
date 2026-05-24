# VidNote — Video Annotation Platform

A full-stack web app for uploading, annotating, and AI-summarizing videos.

**Live demo:** _add deployed URL here_
**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Prisma · Postgres · AWS S3 · NextAuth (Google OAuth) · pluggable LLM (Anthropic / OpenAI / Groq)

---

## Features

| Requirement | Implementation |
|---|---|
| Upload from local system | Direct browser → S3 **multipart** upload, 16 MiB parts, 4-way parallel, per-part retries, drag-and-drop dropzone |
| Upload from URL | Stored as reference, played directly from the source |
| Several-GB videos | Bytes never touch the Next.js server; multipart removes the 5 GB single-PUT cap |
| Video listing | Name, source, duration, upload date, status badge |
| Detail page | HTML5 player, custom timeline, click-to-seek, playback controls, "All videos" back link |
| Timestamp annotation | Add note at current playhead → list view + timeline markers |
| Frame interval annotation | Configurable 1/5/10s slots, auto-generated grid, inline editing |
| Click annotation → jump | Both timestamp list and timeline markers seek the video |
| Summary generation | Pluggable LLM (Anthropic / OpenAI / Groq) stitches annotations into chronological prose; provider chosen via `AI_PROVIDER` env var |
| Delete video | Confirm dialog → removes Prisma row, cascades annotations, deletes the S3 object |
| **+ Auth** | Google OAuth via NextAuth, per-user data isolation |
| **+ Dark mode** | `next-themes` class-based toggle with system preference |

---

## Architecture

```
┌────────────┐    1. POST /api/videos/upload/multipart/start   ┌──────────────┐
│            │ ───────────────────────────────────────────────►│              │
│            │    2. POST .../sign-part  (per part, N times)   │              │
│   Browser  │ ───────────────────────────────────────────────►│              │
│  (Next.js  │    3. PUT presigned part URL × 4 in parallel    │   AWS S3     │
│   client)  │ ───────────────────────────────────────────────►│              │
│            │    4. POST .../complete  (assemble parts)       │              │
│            │ ───────────────────────────────────────────────►│              │
│            │    6. GET presigned URL (streaming playback)    │              │
│            │ ◄───────────────────────────────────────────────│              │
└─────┬──────┘                                                 └──────────────┘
      │ 5. POST /api/videos {key, name, duration}
      │ 7+ /api/videos/[id]/annotations, /summary, DELETE, etc.
      ▼
┌─────────────────┐         ┌──────────────┐         ┌──────────────────────────┐
│ Next.js App     │────────►│  Postgres    │         │  LLM provider            │
│ Route Handlers  │         │              │         │  Anthropic / OpenAI /    │
│ + NextAuth      │         └──────────────┘         │  Groq  (lib/ai.ts)       │
└─────────────────┘                                  └──────────────────────────┘
        ▲
        │ Google OAuth callback
        ▼
   accounts.google.com
```

**Critical decision — video bytes never hit the server.** Vercel functions cap request bodies at ~4.5 MB and a single PUT presigned URL caps at 5 GB. The browser opens a multipart upload, asks our API to sign each 16 MiB part, uploads 4 parts in parallel directly to S3, then asks the API to finalize. Each part has its own retry budget; closing the modal mid-upload aborts the multipart upload so S3 doesn't keep paying for orphaned parts. Duration is read client-side (best-effort, bounded) and backfilled on first playback if it couldn't be read in time. This is what makes multi-GB uploads work on Vercel's free tier without a separate upload backend.

**URL uploads** are stored as references — not proxied, not copied. The `<video>` element streams directly from the source. Tradeoff discussed below.

**Per-user data isolation** is enforced server-side on every route via `requireUser()` + ownership checks. Cross-user access returns 404 (not 403) to avoid leaking existence.

**Pluggable LLM provider** lives in `lib/ai.ts`. The chosen provider's SDK is dynamically imported at request time, so unused providers don't bloat the bundle. Switching is a one-line env change.

---

## Data model

- `User` / `Account` / `Session` / `VerificationToken` — standard NextAuth Prisma adapter tables
- `Video` — `userId` FK, `sourceType ∈ {s3, url}`, `frameIntervalSec` (1/5/10), `summary`, indexed on `(userId, createdAt)`
- `Annotation` — `videoId` FK, `timestamp` (float seconds), `text`, `kind ∈ {timestamp, frame}`, `slotIndex` (frame kind only), indexed on `(videoId, timestamp)`

See [`prisma/schema.prisma`](prisma/schema.prisma).

---

## Running locally

Prereqs: Node 18.18+ (22.x recommended), a Postgres URL, AWS S3 bucket + IAM credentials, a Google OAuth client, and one LLM provider key.

```bash
git clone <this-repo>
cd vidnote
npm install
cp .env.example .env.local         # fill in all values
npx prisma db push                 # creates tables
npm run dev                        # http://localhost:3000
```

`.env.example` documents every variable and which provider each one belongs to. The Google OAuth client must include `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI; the S3 bucket must allow `PUT`/`GET` from `http://localhost:3000` in its CORS policy.

---

## Tradeoffs

Real production gaps in this implementation, not generic "wishlist" items:

1. **No transcoding — Safari will choke on non-H.264 files.** The `<video>` element plays whatever was uploaded. A `.mov` from an iPhone or a `.webm` from OBS works in Chrome but shows a black frame on Safari. Production would transcode to HLS via AWS MediaConvert (or a self-hosted FFmpeg worker) and serve adaptive bitrate.

2. **URL uploads are stored as references, not copied.** Saves storage and avoids GB-scale server-side downloads, but if the source URL 404s, the video is gone. A production version would async-copy to S3 in the background and flip `status` from `processing` to `ready` when done.

3. **Frame-slot annotations re-index when the interval changes.** Slot 3 at a 5s interval represents `0:15`; switch the interval to 10s and slot 3 now points to `0:30`, but the note text doesn't move with the timestamp. The data model stores `slotIndex` but should store `timestamp` as the source of truth and derive `slotIndex` on read.

4. **Delete is best-effort on S3.** The DELETE handler removes the S3 object before the DB row, but if the S3 call throws (creds revoked, transient 5xx) we log and continue so the user isn't stuck with an undeletable row. The worst case is an orphan blob, which a periodic lifecycle sweep can reclaim. The opposite ordering (DB first) would leak orphans even on the happy path.

5. **Two abuse vectors on the cost-bearing paths.**
   - The upload endpoints (`/api/videos/upload/multipart/*` and the legacy `/api/videos/upload-url`) issue presigned PUTs / part URLs with no per-user rate limit, so a user could mint thousands of URLs and upload garbage — billable S3 cost with no matching DB row. Mitigation: per-user quota + S3 lifecycle rule that deletes unreferenced objects after N hours. The upload modal already calls `multipart/abort` when a user closes mid-upload, but a malicious client can simply not call it.
   - `/api/videos/[id]/summary` calls the LLM with no rate limit. A user spamming "Regenerate" burns API credit. Mitigation: per-user request limiter and/or a "regenerate only if annotations changed" guard.

6. **Summary prompt is unbounded.** All annotations are stitched into one prompt. A long video with 200 annotations easily exceeds the context window on cheaper models, and the summary quality degrades long before that. Production would chunk + map-reduce: summarize each window separately, then summarize the summaries.

---

## File map

```
app/
  layout.tsx                          # ThemeProvider + SessionProvider wrap
  page.tsx                            # Video list (server component, auth-gated)
  login/page.tsx                      # Google sign-in
  videos/[id]/page.tsx                # Detail page (server) + workspace (client)
  api/
    auth/[...nextauth]/route.ts       # NextAuth handler
    videos/
      route.ts                        # GET list, POST create
      upload-url/route.ts             # POST → presigned S3 PUT (legacy single-shot path)
      upload/multipart/
        start/route.ts                # POST → CreateMultipartUpload, returns uploadId
        sign-part/route.ts            # POST → presigned UploadPart URL for one partNumber
        complete/route.ts             # POST → CompleteMultipartUpload (stitches parts)
        abort/route.ts                # POST → AbortMultipartUpload (cleanup on cancel)
      [id]/
        route.ts                      # GET / PATCH / DELETE (DELETE also removes S3 object)
        playback-url/route.ts         # presigned GET for S3, raw URL for external
        annotations/route.ts          # POST (upsert for frame, insert for timestamp)
        annotations/[aid]/route.ts    # DELETE
        summary/route.ts              # POST → calls lib/ai.ts
components/
  app-shell.tsx                       # Top bar layout
  providers.tsx                       # Theme + Session providers
  theme-toggle.tsx                    # Dark mode switch
  user-menu.tsx                       # Avatar + sign out
  upload-modal.tsx                    # Tabbed file/URL upload, drag-and-drop dropzone, multipart client
  video-workspace.tsx                 # Player + annotations + frame slots + summary + back link + delete dialog
  ui/                                 # Hand-rolled shadcn-style primitives
lib/
  prisma.ts                           # Singleton client
  auth.ts                             # NextAuth config + requireUser() helper
  s3.ts                               # AWS SDK + presign / multipart / delete helpers + key builder
  ai.ts                               # Pluggable LLM client (Anthropic / OpenAI / Groq)
  api.ts                              # withApi() wrapper + ApiError
  utils.ts                            # cn(), formatDuration(), formatRelativeDate()
prisma/
  schema.prisma                       # Users, NextAuth tables, Video, Annotation
```
