# Tracearr Fork Information

This file documents the local fork overlay so future upstream updates can preserve the fork-specific behavior intentionally.

## Comparison Snapshot

- Fork working tree: `/home/dev/work/Tracearr`
- Fork branch/SHA inspected: `feature/version-2.0-preparation` at `6a284d7a`
- Source repository checkout: `/tmp/Tracearr`
- Source branch/SHA inspected: `main` at `c600f88f`
- Last shared upstream commit found during inspection: `367f6c69`
- Latest upstream commit merged into the current working tree: `c600f88f`
- Temporary comparison ref used locally: `source-tmp/main`

Useful commands for re-checking this later:

```bash
git fetch /tmp/Tracearr main:refs/remotes/source-tmp/main
git merge-base HEAD source-tmp/main
git diff --stat source-tmp/main..HEAD
git diff --name-status source-tmp/main..HEAD
```

## What This Fork Adds

The primary fork-owned change is first-class Dispatcharr support. The fork lets Tracearr track Dispatcharr Live TV and VOD streams alongside Plex, Jellyfin, and Emby.

General fork rule:

- When upstream changes touch server models, auth flows, polling/realtime, or UI around media-server management, treat Dispatcharr support as an intentional overlay that must be ported forward explicitly. Do not assume those changes are incidental drift that can be dropped during merge conflict resolution.

User-facing Dispatcharr behavior:

- Add Dispatcharr as a selectable server type.
- Connect to Dispatcharr with either an API key/JWT token or username/password credentials.
- Edit an existing Dispatcharr server in place to switch between API key/JWT token auth and username/password auth without deleting and re-adding the server.
- Use username/password mode for WebSocket-capable realtime updates; API-key mode falls back to REST polling.
- Legacy Dispatcharr servers upgraded from older fork versions remain in polling mode until username/password credentials are entered again, because older stored tokens do not contain recoverable credentials for automatic migration.
- Show Live TV streams, VOD movies, and VOD shows.
- Dispatcharr does not provide a Media library catalog or VOD library synchronization; it remains supported for sessions, history, Live TV/VOD streams, and user synchronization.
- Optionally ignore streams reported as anonymous.
- Terminate Dispatcharr live/VOD streams from Tracearr.
- Display Live TV channel/programme information, channel logos, stream bitrate, codecs, resolution, and FFmpeg speed where available.
- Jellyfin and Emby Live TV sessions are enriched from `/LiveTv/Programs`; the current programme is stored in `mediaTitle` while the channel remains in `live.*`. The EPG cache is shared per server/channel and refreshes the existing poller at programme boundaries. Web and mobile Live TV cards use the same channel-title/programme-subtitle layout as Dispatcharr; Plex keeps its legacy Live TV card for now.
- Show Dispatcharr active sessions immediately from healthy WebSocket snapshots.
- Save Dispatcharr Live TV sessions to history only after a configurable threshold; default is 30 seconds and `0` means always save. This threshold does not delay active-session visibility, does not emit a second stream-start event when history is confirmed, and does not apply to Dispatcharr VOD history.

The fork also carries local maintenance/distribution changes:

- README has fork-specific warnings, Docker image names, and Dispatcharr feature notes.
- Renovate scheduled execution is disabled in `.github/workflows/renovate.yml`.
- CI runs only for pull requests; merges to `main` do not trigger a second CI run.
- Release automation is manual-only, so merging to `main` does not create a release, push Docker images, or post to Reddit.
- Local Husky hooks were removed.
- `.tmp/`, `.plans/`, `AGENTS.md`, and this `FORK_INFO.md` are ignored locally.
- `AGENTS.md` documents the Pull Request CI workflow warning baseline. Read both `AGENTS.md` and this file before making changes, and update either file when a change affects repo instructions, fork overlay behavior, validation workflow expectations, warning counts, or future merge guidance.

## Typical Dispatcharr-Specific Changes

Most fork-only changes made for Dispatcharr fall into a few recurring categories:

- Shared model extensions:
  - add `dispatcharr` to server enums, schema validation, and frontend/backend shared types
  - carry Dispatcharr-only settings such as auth mode, anonymous-stream filtering, and live-history threshold
- Server configuration flow:
  - accept both token-based auth and username/password auth
  - allow switching auth mode in place while editing an existing server
  - avoid exposing stored token values back to the frontend response shape
- Realtime and polling:
  - use a dedicated Dispatcharr realtime connector instead of the existing Plex/Jellyfin/Emby SSE path
  - keep fallback polling when realtime is unavailable or when token auth cannot support realtime
  - bypass normal poller processing while healthy Dispatcharr realtime snapshots are active
- Session semantics:
  - treat Live TV and VOD differently
  - delay history persistence only for Dispatcharr Live TV when the threshold is enabled
  - keep VOD persistence immediate
- Metadata and media presentation:
  - map channel/programme-specific live metadata
  - classify Dispatcharr catch-up/timeshift sessions as Live TV with estimated progress and a separate playback kind
  - support Dispatcharr images, logos, codecs, bitrate, and FFmpeg speed details
- Termination and sync:
  - route session termination through Dispatcharr-specific identifiers/endpoints
  - sync Dispatcharr users through the generic server sync path
- Frontend/mobile presentation:
  - expose Dispatcharr as a first-class server option
  - show Dispatcharr-specific setup guidance, polling/realtime state, and Live TV labels/cards/history rows
- Tests:
  - cover Dispatcharr parser/client/realtime behavior
  - extend server routes, public API formatting, image proxy, and UI tests for Dispatcharr cases

## Where The Fork Changes Code

Shared contracts:

- `packages/shared/src/schemas.ts` adds `dispatcharr` to server type validation and extends server create/update schemas with Dispatcharr credentials/settings.
- `packages/shared/src/types.ts` extends server-related types with `dispatcharr`, `dispatcharrAuthMode`, `ignoreAnonymousStreams`, and `dispatcharrLiveHistoryThresholdSeconds`.
- `packages/shared/src/constants.ts` adds Dispatcharr brand color support.

Database:

- `apps/server/src/db/schema.ts` extends `serverTypeEnum` and adds two server columns:
  - `ignore_anonymous_streams boolean default true not null`
  - `dispatcharr_live_history_threshold_seconds integer default 30 not null`
- It also adds Dispatcharr playback metadata to `sessions`:
  - `dispatcharr_playback_kind varchar(20)`
  - `progress_estimated boolean default false not null`
- `apps/server/src/db/migrations/` is the upstream-only migration history. It must remain directly mergeable with the source repository.
- `apps/server/src/db/fork-migrations/` is the Dispatcharr overlay, with its own `meta/_journal.json` and `tracearr_fork.__drizzle_migrations` database ledger. Its current files `0000`–`0002` replace the historical main-ledger migrations `0067`–`0069`.
- Before upstream migrations, the runtime removes the exact legacy `0069_steady_squadron_supreme` ledger entry only when `media` is absent. This is a one-time compatibility bridge: its timestamp would otherwise cause Drizzle to skip upstream `0067_cold_maggott`, which creates `media`.
- The overlay runs after upstream migrations. Its SQL is idempotent so installations that previously ran `0067`–`0069`, installations where they were skipped, and original Tracearr databases all converge without data loss.

Server-side Dispatcharr integration:

- `apps/server/src/services/mediaServer/dispatcharr/client.ts` implements the Dispatcharr media server client.
- `apps/server/src/services/mediaServer/dispatcharr/parser.ts` normalizes Dispatcharr status, user, Live TV, VOD, codec, profile, programme, and image data into Tracearr session shapes.
- `apps/server/src/services/mediaServer/dispatcharr/realtime.ts` implements Dispatcharr WebSocket handling with REST bootstrap/fallback behavior, including `timeshift_stats` catch-up updates and periodic EPG refresh.
- `apps/server/src/services/mediaServer/index.ts` registers `DispatcharrClient` in the media server factory.
- `apps/server/src/services/mediaServer/types.ts` carries Dispatcharr-specific config through the generic media server interface.

Server routes and services:

- `apps/server/src/routes/servers.ts` accepts Dispatcharr credentials/settings, verifies connections, stores encoded username/password credentials when token auth is not used, and returns Dispatcharr settings.
- `apps/server/src/services/sync.ts` syncs Dispatcharr users through the generic user sync path.
- `apps/server/src/services/termination.ts` passes Dispatcharr config into session termination.
- `apps/server/src/services/imageProxy.ts` normalizes Dispatcharr image paths, supports Dispatcharr channel logos, and uses `inside` resize fit for Dispatcharr images.
- Dispatcharr channel-logo proxy requests must use the configured server origin
  and an empty header set. Do not reintroduce generic `Accept` or auth headers
  when refactoring the shared image-proxy request builder; preserve URL
  normalization and `fit: inside` while retaining upstream cache/LQIP behavior
  for other server types.
- `apps/server/src/routes/public.ts` and `apps/server/src/routes/public.openapi.ts` expose Dispatcharr-aware live media fields in public API responses.
- Dashboard daily stats keep `todayPlays`, `todaySessions`, and `watchTimeHours` as VOD-only metrics, add `tvSessions`, `tvChannels`, and `tvWatchTimeHours` for `mediaType === 'live'`, and count `activeUsersToday` across all media types so Dispatcharr Live TV/catch-up activity is no longer invisible on the homepage.
- Activity stats (`plays`, `concurrent`, day/hour activity, platforms, quality, users, and top users) include `movie`, `episode`, and `live` sessions from every supported server type. The two-minute intentional-play threshold remains limited to the plays/activity charts; Dashboard, engagement, and other primary-statistics filters remain VOD-only.
- `apps/server/src/routes/sessions.ts` carries `dispatcharrPlaybackKind` through `/sessions/history` so History UI can distinguish Dispatcharr catch-up/timeshift rows from ordinary Live TV.

Realtime and polling:

- `apps/server/src/services/sseManager.ts` manages Dispatcharr WebSocket connectors in addition to Plex/Jellyfin/Emby SSE.
- `apps/server/src/jobs/dispatcharrRealtimeProcessor.ts` consumes healthy Dispatcharr WebSocket snapshots directly, updates the active-session cache, and publishes existing `session:started`, `session:updated`, and `session:stopped` events.
- `apps/server/src/index.ts` starts and stops the Dispatcharr realtime processor with other background services.
- `apps/server/src/jobs/poller/processor.ts` skips normal Dispatcharr session processing while WebSocket mode is healthy. Dispatcharr polling remains the fallback for API-key/token mode, disconnected/fallback WebSocket mode, and explicit reconciliation after realtime loss.
- Dispatcharr Live TV history confirmation is keyed to Live TV media classification (`media.type === 'live'` after parsing), not server type alone. Confirming history updates the already-visible active session in place. VOD sessions persist, update, and stop immediately through realtime or polling regardless of the Live TV threshold setting.
- Dispatcharr catch-up/timeshift sessions are also keyed to `media.type === 'live'`, but carry `dispatcharrPlaybackKind === 'catchup'` and `progressEstimated === true`. Catch-up uses `/proxy/stats/` plus `/proxy/catchup/programs/` for enrichment. Programme title and EPG timeline update in place like Dispatcharr Live TV; the resolved programme must not be part of catch-up session identity.
- `apps/server/src/jobs/poller/stateTracker.ts` supports a configurable confirmation threshold and detects media-title changes for DB writes.
- `apps/server/src/jobs/poller/types.ts` extends poller server/session types to include Dispatcharr.

Web UI:

- `apps/web/src/components/settings/ServerSettings.tsx` adds Dispatcharr server creation/editing, in-place auth mode switching, anonymous-stream filtering, live history threshold controls, and Dispatcharr-specific realtime setup guidance for legacy token-based servers.
- `apps/web/src/components/icons/MediaServerIcon.tsx` and `apps/web/public/images/servers/dispatcharr.png` add Dispatcharr branding.
- `apps/web/src/components/sessions/NowPlayingCard.tsx` shows Live TV channel/programme-oriented cards.
- Catch-up cards must continue to use the Live TV visual grouping, but favor progress/remaining-time presentation over FFmpeg live-speed presentation.
- `apps/web/src/pages/Dashboard.tsx` now renders six daily stat cards in this order: Alerts, VOD Plays, VOD Watch Time, TV Sessions, TV Watch Time, Active Users.
- `apps/web/src/components/history/HistoryTable.tsx` fixes column sizing/truncation for long Live TV content, improves history layout, and shows the Dispatcharr catch-up indicator for catch-up rows.
- `apps/web/src/components/history/StreamDetailsPanel.tsx` shows FFmpeg speed and Dispatcharr-oriented stream details.
- `apps/web/src/lib/api.ts`, `apps/web/src/hooks/queries/useServers.ts`, and `apps/web/src/hooks/useServer.tsx` carry Dispatcharr server settings through the frontend API/cache layer.

Mobile UI:

- `apps/mobile/src/lib/mediaConfig.ts` and `apps/mobile/app/session/[id].tsx` add Dispatcharr label/color metadata.
- `apps/mobile/src/components/sessions/NowPlayingCard.tsx` displays Live TV as channel plus programme instead of generic media title.
- `apps/mobile/src/components/history/HistoryRow.tsx` fixes Live TV history content labels and shows the Dispatcharr catch-up indicator for catch-up rows.
- `apps/mobile/src/hooks/useImageUrl.ts` accepts absolute image URLs for Dispatcharr images.

Tests:

- Dispatcharr server tests live mainly under `apps/server/src/services/mediaServer/__tests__/dispatcharr-*.test.ts`.
- Supporting tests cover public API formatting, image proxy behavior, server routes/settings including Dispatcharr auth-mode edits, poller pending progress, web server selector/settings, Now Playing, history table, and stream details.

## Why These Changes Exist

Dispatcharr differs from the original supported media servers in several ways:

- Live TV state comes from Dispatcharr transport-stream status endpoints and can be enriched with channel/logo/current-programme APIs.
- VOD state can be included in Dispatcharr realtime snapshots and is not gated by the Live TV history threshold.
- Catch-up state arrives from `/proxy/stats/` and `timeshift_stats`, while EPG enrichment comes from `/proxy/catchup/programs/`; both sources are required to keep programme titles, boundaries, and estimated progress current without splitting a single catch-up viewing session.
- WebSocket auth needs a JWT, while API keys can still support REST polling.
- Live TV sessions can be too short/noisy for useful history, so the fork adds a configurable history threshold.
- Catch-up playhead is approximate: Dispatcharr reports anchors such as `programme_start`, `position_anchor_at`, and optional `playback_base_secs`, not a guaranteed client-authoritative position.
- Dispatcharr can report anonymous clients; the fork defaults to ignoring them to reduce noise.
- Session identifiers and termination endpoints differ between live and VOD streams.

## Future Upstream Update Notes

When merging or rebasing on source `main`, preserve the Dispatcharr overlay deliberately instead of treating it as incidental drift.

General merge rules:

- Prefer upstream as the baseline for auth hardening, security fixes, dependency/toolchain updates, generic SSE robustness, and identity/user model changes.
- Prefer the fork for Dispatcharr-specific capabilities, but port them onto the upstream structure instead of keeping older fork control flow wholesale.
- Do not resolve high-risk conflicts by taking the entire fork file or entire upstream file in:
  - shared server schemas/types
  - `apps/server/src/routes/servers.ts`
  - `apps/server/src/services/sseManager.ts`
  - `apps/server/src/jobs/poller/processor.ts`
  - Dispatcharr web/mobile settings and status UI
- Reconcile schema intent first, then regenerate migrations and lockfile artifacts afterwards.
- If a commit is labeled as lint/typecheck cleanup, still inspect it for hidden behavioral overlap before replaying it after a merge. Some recent CI-cleanup commits also touched active Dispatcharr integration points.

High-conflict areas to review manually:

- Shared server type definitions and schemas.
- Drizzle migrations and `servers` table shape.
- `apps/server/src/routes/servers.ts`.
- `apps/server/src/services/mediaServer/index.ts` and media server generic types.
- `apps/server/src/services/sseManager.ts`.
- `apps/server/src/jobs/poller/processor.ts`, `stateTracker.ts`, and poller types.
- `apps/server/src/services/imageProxy.ts`, `sync.ts`, and `termination.ts`.
- Public API current-session formatting and OpenAPI schema.
- Web `ServerSettings`, Now Playing/history components, and API hooks.
- Mobile server metadata and Live TV display.

Current upstream merge notes:

- Upstream `main` at `c600f88f` was merged into `feature/version-2.0-preparation` on Wednesday, August 5, 2026 (merge commit `6a284d7a`). The merge retains the Dispatcharr library-capability guard: Dispatcharr remains excluded from library-sync scheduling and media catalog work while receiving session/history support.
- Upstream's Timescale maintenance, session-identity backfill, library-sync queue, import transaction, supervised Docker, and translation changes were retained. The database-client test conflict was resolved by retaining both the fork migration-ledger coverage and upstream raw-client error-listener coverage; the Dutch settings translation retains Dispatcharr configuration/realtime and fork-version keys alongside upstream localization updates.

- Upstream `main` at `367f6c69` has been merged into `feature/version-2.0-preparation` in the current working tree on Tuesday, August 4, 2026 (merge commit `0f7e1597`, followed by Dispatcharr reconciliation `368c460f`).
- The merge ports the Dispatcharr overlay onto Tracearr 2.0: the new media/version schema, public API v2, mobile navigation and SSE plugin recovery behavior are retained alongside Dispatcharr auth, polling/realtime snapshots, history-threshold semantics, catch-up metadata, and image handling.
- Upstream migration history is now aligned through `0082_backfill_last_activity.sql`; the Dispatcharr overlay remains in its separate fork ledger.
- Migration `0063_long_maria_hill.sql` must keep upstream's login-username collision auto-rename block before creating `users_login_username_unique`; without it, `loginUsernameCollision.integration.test.ts` fails.
- Dispatcharr migrations now live in the separate fork overlay, leaving `apps/server/src/db/migrations/` aligned to upstream through `0066`.
- Local CI-equivalent validation for this merge should be rerun with Node 24 via `npx --yes -p node@24 -p pnpm@11.11.0 pnpm ...` before considering the working tree ready.

### Migration History Policy

- Drizzle compares the latest `created_at` only within one ledger. The upstream and fork ledgers are intentionally separate so an original Tracearr database with newer upstream migrations still receives all missing Dispatcharr migrations.
- The pre-ledger Dispatcharr `0069_steady_squadron_supreme` entry remains a special upgrade case: before upstream migration, remove only its known hash/timestamp pair when `public.media` is missing. Do not generalize this to deleting arbitrary ledger rows.
- Keep upstream migration files and journal entries immutable and merge them from source as-is. Create fork schema changes only with `pnpm --filter @tracearr/server db:fork:generate -- <name>`; it creates a new overlay SQL file and monotonic journal entry.
- `db:generate` and `db:push` are deliberately disabled in this fork because the combined runtime schema would otherwise emit Dispatcharr DDL into the upstream history.
- Before releasing a migration-affecting merge, test a fresh database, an upgrade from the latest upstream release, and an upgrade from the prior fork release. Confirm `servers` rows survive, the fork ledger is populated, and all Dispatcharr columns exist.

Recommended merge workflow:

```bash
git fetch /tmp/Tracearr main:refs/remotes/source-tmp/main
git checkout develop
git checkout -b merge/upstream-main-2026-07-18
git merge source-tmp/main
pnpm install
pnpm test:unit
pnpm test:services
pnpm test:routes
pnpm test:security
```

For this environment, if global `pnpm` or Node is unavailable, use:

```bash
npx --yes -p node@24 -p pnpm@11.11.0 pnpm test:unit
```

## Minimum Dispatcharr Smoke Test After Merge

After an upstream merge that touched any server, auth, polling, realtime, or UI flow, do at least this minimum manual verification for Dispatcharr:

1. Add a new Dispatcharr server with token auth and verify it saves successfully.
2. Add or edit a Dispatcharr server with username/password auth and verify the server can switch into realtime-capable mode.
3. Open the server settings UI and confirm Dispatcharr-specific controls are still present:
   - auth mode handling
   - anonymous-stream filtering
   - live-history threshold
4. Verify a Dispatcharr Live TV session appears in active sessions.
5. Verify Dispatcharr VOD still appears and persists without waiting for the Live TV threshold.
6. Confirm Dispatcharr channel/logo or image URLs still render through the current frontend/mobile image flow.
7. Confirm terminating a Dispatcharr session still works.
