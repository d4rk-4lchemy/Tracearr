# E2E Tests

End-to-end browser tests for Tracearr using [Playwright](https://playwright.dev/). These tests exercise real user flows against the full stack (API server + web app) in a Chromium browser.

## Prerequisites

### Services

The E2E tests require a running TimescaleDB (PostgreSQL) and Redis instance. They run against the **isolated test containers** (never the live dev stack):

```bash
docker compose -f docker/docker-compose.test.yml up -d
```

This starts TimescaleDB on port 5433 and Redis on port 6380. If your services run on different ports, override them with `E2E_DATABASE_URL` and `E2E_REDIS_URL` (see [Configuration](#configuration)) - but the target database name must always be the one the run selected - `tracearr_e2e`, or `tracearr_showcase` under `SHOWCASE=1`; the seed refuses to run against anything else (see [Media browse seed](#media-browse-seed)).

### Browser

Install Playwright's browser binaries (one-time setup):

```bash
pnpm --filter @tracearr/e2e exec playwright install chromium
```

### Servers

The test runner automatically starts the API server (port 3000) and web dev server (port 5173) via the `webServer` config in `playwright.config.ts`. You can also start them manually and they'll be reused.

## Running Tests

```bash
# Run all tests headless
pnpm --filter @tracearr/e2e test:e2e

# Open the interactive UI mode (pick & run tests visually)
pnpm --filter @tracearr/e2e test:e2e:ui

# Run tests in a visible browser window
pnpm --filter @tracearr/e2e test:e2e:headed

# Run tests in debug mode (step through with inspector)
pnpm --filter @tracearr/e2e test:e2e:debug

# Open the HTML report from the last run
pnpm --filter @tracearr/e2e test:e2e:report

# Just the media-browse suite (setup + seed-link + spec projects)
pnpm --filter @tracearr/e2e test:e2e:media
```

## Configuration

Environment variables are loaded from the root `.env` file. The following can be overridden:

| Variable           | Default                                              | Description                                   |
| ------------------ | ---------------------------------------------------- | --------------------------------------------- |
| `E2E_DATABASE_URL` | `postgresql://test:test@localhost:5433/tracearr_e2e` | Database connection - name must match the run |
| `E2E_REDIS_URL`    | `redis://localhost:6380`                             | Redis connection                              |
| `E2E_REDIS_PREFIX` | `trr_e2e_`                                           | Redis key prefix, isolates this run's keys    |
| `CLAIM_CODE`       | `tracearr-e2e-test-claim-code`                       | Claim code for first-time setup gate          |
| `SHOWCASE`         | unset                                                | Set to `1` for the screenshot run (see below) |
| `SHOWCASE_OUT`     | `showcase/out`                                       | Where the captured images are written         |
| `E2E_BUILD`        | unset                                                | Set to `1` to test the built app on port 3000 |

## Test Structure

| File                    | What it tests                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `auth.setup.ts`         | Authentication setup project: handles first-time signup or login, saves auth state for other tests |
| `media-browse.setup.ts` | Phase 2 of the media browse seed: links the just-created owner to a watched title (see below)      |
| `auth.spec.ts`          | Login page, unauthenticated redirects, credential login                                            |
| `automations.spec.ts`   | Create and delete template and custom automations, filter the list by kind                         |
| `dashboard.spec.ts`     | Dashboard stat cards, sidebar navigation links                                                     |
| `media-browse.spec.ts`  | Media landing shelves/KPIs, grid pagination, letter rail, filters, detail, watched markers         |
| `navigation.spec.ts`    | Page navigation for all routes including collapsible sub-categories                                |
| `settings.spec.ts`      | Settings page tabs and section content                                                             |

## Media browse seed

`media-browse.spec.ts` needs data no other spec provisions (two media servers, ~90 movies/shows,
watch history) and it must never touch a real library. The seed is fail-closed by design:

1. **Guard.** `seed/guard.ts` runs `SELECT current_database()` before any write and throws unless the
   name is exactly `tracearr_e2e`. Every seed script (`prepareDatabase.mjs`, `globalSetup.ts`,
   `media-browse.setup.ts`) calls this (or an equivalent literal check) before touching a row.
2. **Database + migrations, before the server even boots.** Playwright starts the `webServer`
   processes ahead of `globalSetup.ts` (not after - webServer is plugin setup, which precedes the
   `globalSetups` array), so `seed/prepareDatabase.mjs` is chained into the server's own `webServer`
   command: it creates `tracearr_e2e` on the test container if missing and applies the server's own
   migrations (`db:migrate`) before `pnpm --filter @tracearr/server dev` ever starts - otherwise the
   app's boot-time migration runner would crash-loop against a database that doesn't exist yet on a
   fresh checkout.
3. **Bulk fixture data.** `seed/globalSetup.ts` is Playwright's `globalSetup` hook - it runs once,
   after the webServer is already up, and seeds two media servers, ~90 movies/shows, and watch
   history (idempotent - safe to rerun). It also re-runs the ensure/migrate steps defensively in case
   a stale server process was reused instead (`reuseExistingServer`).
4. **Admin link.** One scenario (a title marked "watched by you") needs the real signed-in owner's id,
   which only exists after `auth.setup.ts` signs up/logs in. `media-browse.setup.ts` runs as its own
   Playwright project (`media-seed`, depends on `setup`) to link that account and refresh the watch
   aggregate.

First-time local setup (idempotent - safe to run again, and `globalSetup.ts` also does this check
itself on every run):

```bash
docker exec docker-timescale-test-1 psql -U test -d postgres -c 'CREATE DATABASE tracearr_e2e'
```

Then just run `pnpm --filter @tracearr/e2e test:e2e:media` - migrations and seeding happen
automatically.

## Showcase captures

The screenshots the website and the README use come from this workspace too. Instead of
photographing a real install, `showcase/` fills a database of its own with a fake cast - three
servers, thirteen people, a 110-title library, a Plex music library of about twenty artists with
their albums and tracks, ninety days of watch and listen history, automations with runs, and a
sent newsletter - and Playwright captures the UI against it.

Artwork and title metadata are exported once from a real install:

```bash
node apps/e2e/showcase/exportFromDev.mjs
```

That writes the git-ignored `showcase/assets/`: `titles.json` and `music.json` (artist, album and
track titles, years and genres, nothing else) plus `posters/<n>.webp` (360x540 posters copied from
the dev server's image cache) and `posters/sq<n>.webp` (360x360 artist and album art). Square art
the cache lacks is requested through the dev server's image proxy, so the dev server has to be
running on :3000 for the export. Any title whose art cannot be had, including a proxy answer that
is the "No image" placeholder, is left out rather than seeded bare. Music comes from the dev server
with the most artists (`DEV_MUSIC_SERVER_ID` overrides it); only artists with album art make the
cut, the ones with the most albums first, and the first of them is the artist page capture.

The image proxy only fetches paths shaped like the server type's own, so the seed stores posters
as `/library/metadata/showcase/thumb/<n>` on Plex and `/Items/showcase/Images/Primary?tag=<n>` on
Jellyfin and Emby, and `showcase/assetServer.ts` maps both back to `posters/<n>.webp`.

The stream map needs the basemap (`pnpm basemap`, git-ignored at `data/basemap.pmtiles`); without
it the map captures are blank and every page carries the bad-mounts banner. Then stop the dev
server, because Playwright reuses whatever answers on :3000 and :5173 and would photograph the
dev database instead:

```bash
pnpm --filter @tracearr/e2e showcase
```

Images land in `showcase/out/` as webp, one per capture; `SHOWCASE_OUT=/abs/dir` sends them
somewhere else. The run takes the version badge from the newest file in `release-notes/` and
drops the `server:down` pushes the poller sends about the fake servers, so neither the update
badge nor the health banner shows. The server runs under `tsx watch`, so an edit under
`apps/server` mid-run restarts it and the capture in flight fails on a redirect; rerun, or start
the API without watch first with the same environment and Playwright reuses it.

| Capture                                                                             | What it shows                                                    |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `dashboard`                                                                         | Dashboard with three streams playing                             |
| `activity`, `stats-activity`                                                        | Stats Activity, plays stacked by movies, shows and music         |
| `stats-people`, `stats-devices`, `stats-bandwidth`                                  | The other Stats tabs                                             |
| `map`                                                                               | Stream map                                                       |
| `automations`, `automation-detail`, `violations`                                    | Automations rules, one rule, the Violations tab                  |
| `users`, `users-merge-suggestion`, `users-merge-dialog`                             | Users table, the merge callout and the merge dialog              |
| `user-detail`, `user-accounts`                                                      | A user's overview and the linked accounts card on the Access tab |
| `media-overview`, `media-shelves`                                                   | Library overview and its shelves                                 |
| `library-genres`, `library-genres-sheet`                                            | Library Genres, then the sheet for the top genre                 |
| `library-quality`, `library-storage`, `media-duplicates`                            | Library Quality and Storage, the duplicates card                 |
| `media-browse`, `media-detail`                                                      | Browse movies and one movie                                      |
| `media-browse-music`, `media-detail-artist`                                         | Browse artists, then an artist page with an album sheet open     |
| `settings-email`, `settings-newsletters`, `newsletter-editor`, `newsletter-history` | Email and newsletter settings                                    |
| `digest-email`                                                                      | The newsletter email itself                                      |

`SHOWCASE=1` moves every default in `seed/env.ts`, `seed/prepareDatabase.mjs` and
`playwright.config.ts` from `tracearr_e2e` to `tracearr_showcase` and the Redis prefix from
`trr_e2e_` to `trr_showcase_`, and the guard then accepts only that name - the normal suite and the
showcase can never write to each other's database, and neither can reach the dev stack on
5432/6379. `globalSetup.ts` skips `seedCore` when the flag is set; `showcase/seed.ts` seeds
everything itself, including the automations, which it materializes from the built-in templates the
server writes at boot (so the database needs one server boot before the first capture run).

## Auth State

The setup project (`auth.setup.ts`) runs first and saves browser storage state to `.auth/user.json`. All other test files reuse this state so they start already logged in. The `.auth/` directory is gitignored.
