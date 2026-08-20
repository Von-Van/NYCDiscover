# NYC Discover

NYC Discover turns a free block of time into a small, practical same-day itinerary. It combines nearby places, city events, weather, transparent estimates, and a bounded itinerary search instead of returning another long list.

The desktop web app is a launch candidate for a guest-only public beta at `nycdiscover.vercel.app`. Fixture mode remains the default for local development and the intentional first-production bootstrap.

## Stack

- `apps/web`: Next.js 16, React 19, MapLibre, Vitest, Playwright
- `services/api`: FastAPI, Python 3.12, asyncpg, numbered SQL migrations
- Neon PostgreSQL: provider cache, distributed throttles, rate windows, and seven-day shares
- Vercel Services: one origin for Next.js and FastAPI
- Vercel Analytics and Speed Insights, plus privacy-scrubbed Sentry instrumentation

## Branch Layout

- `main` owns the desktop web app and shared FastAPI service.
- `ios` owns the native SwiftUI app used for iPhone simulator and device testing.
- Launch work is staged on `codex/launch-v1` before an exact tested commit reaches `main`.

The additive API fields remain compatible with the untouched iOS branch.

## How It Works

```mermaid
flowchart TD
    Visitor["Open NYC Discover"] --> Brief["Enter location, time, budget, group, transport, and mood"]
    Brief --> Geocode["Resolve an NYC starting point"]
    Geocode --> Generate["POST /api/v1/itineraries/generate"]
    Generate --> Mode{"Fixture or live mode?"}

    Mode -->|Fixture| Fixtures["Deterministic places, events, and weather"]
    Mode -->|Live| Guard["HMAC anonymous rate window in PostgreSQL"]
    Guard --> Cache{"Fresh provider cache?"}
    Cache -->|Yes| Inputs["Candidate places, events, and weather"]
    Cache -->|No| Throttle["Reserve a provider call in PostgreSQL"]
    Throttle --> Providers["Nominatim, Overpass, NYC Events, and NWS"]
    Providers --> Stale{"Provider available?"}
    Stale -->|Yes| SaveCache["Store fresh response"]
    Stale -->|No| StaleCache["Use stale response when available"]
    SaveCache --> Inputs
    StaleCache --> Inputs

    Fixtures --> Engine["Filter constraints and build bounded itineraries"]
    Inputs --> Engine
    Engine --> Fit{"At least one honest fit?"}
    Fit -->|No| Adjust["Show warnings and reopen the brief"]
    Fit -->|Yes| Results["Compare cost, time, confidence, timeline, and map"]
    Adjust --> Brief

    Results --> Share{"Create a share?"}
    Share -->|No| Verify["Verify details before leaving"]
    Share -->|Yes| Token["Verify the one-hour signed snapshot token"]
    Token --> Redact["Remove origin label, coordinates, and regeneration seed"]
    Redact --> Store[("Store every comparison plan for seven days")]
    Store --> Shared["Read-only /share/id workspace with noindex"]
    Shared --> NewPlan["Make your own plan"]
    NewPlan --> Brief
```

## Quick Start

### Docker

Docker runs PostgreSQL, applies migrations, then starts FastAPI and Next.js:

```bash
cp .env.example .env
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). API docs are at [http://localhost:8000/docs](http://localhost:8000/docs).

### Split Development

Use Node 22/npm 10 and Python 3.12:

```bash
cp .env.example .env
docker compose up postgres -d

cd services/api
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cd ../..

set -a; source .env; set +a
npm run db:migrate
```

Start FastAPI:

```bash
cd services/api
source .venv/bin/activate
uvicorn app.main:app --reload --env-file ../../.env
```

Start Next.js in another terminal:

```bash
npm ci
set -a; source .env; set +a
npm run dev
```

### Combined Vercel Runtime

After installing both dependency sets and applying migrations:

```bash
set -a; source .env; set +a
npm run dev:vercel
```

This mounts FastAPI at `/api` on the same origin as Next.js. Health and docs are available at `/api/healthz` and `/api/docs`. The command forces fixture mode and disables browser fallback so a generated itinerary proves the Python service handled the request.

## Environment

`FIXTURE_MODE=true` requires no provider keys and can operate without PostgreSQL. Add a migrated `DATABASE_URL` and `SHARE_SIGNING_SECRET` when fixture-mode share testing is needed.

Live mode fails closed unless all shared infrastructure is configured:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon pooled connection URL |
| `NYC_EVENT_CALENDAR_KEY` | Primary or secondary key from **Event Calendar Public Developers** |
| `NYC_DISCOVER_USER_AGENT` | Contactable identity for public providers |
| `SHARE_SIGNING_SECRET` | HMAC signing for one-hour generation snapshots |
| `REQUEST_HASH_SECRET` | HMAC key for anonymous rate-limit identifiers |
| `SENTRY_DSN` | Server-side Sentry DSN |
| `NEXT_PUBLIC_SENTRY_DSN` | Browser Sentry DSN |
| `NEXT_PUBLIC_API_URL` | `/api` for every hosted environment |
| `NEXT_PUBLIC_DEMO_FALLBACK` | Must be `false` when hosted |
| `NEXT_PUBLIC_ALLOW_INDEXING` | `false` for bootstrap/Preview; `true` only for live Production |
| `NEXT_PUBLIC_APP_URL` | Canonical public origin |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Protected Preview and rate-limit bypass for CI smoke tests |

Never commit provider keys, database URLs, HMAC secrets, Sentry DSNs, or protection bypass values.

## Data and Privacy

- Live provider calls are serialized across instances using PostgreSQL reservations.
- Anonymous limits store only an HMAC of Vercel's trusted forwarded IP, never the raw address.
- Share links use unguessable 128-bit IDs and expire after seven days.
- Shared snapshots remove the location label, origin coordinates, regeneration seed, and first-leg origin.
- Sentry omits request bodies, query values, headers, cookies, user data, credentials, and individual share IDs.
- Vercel analytics receives no custom location events.

See the in-app `/privacy` page for the visitor-facing version.

## Verification

```bash
# Web lint and unit tests
npm run lint
npm test

# API tests; PostgreSQL cases skip unless TEST_DATABASE_URL is set
npm run test:api

# Full API suite with local PostgreSQL
TEST_DATABASE_URL=postgresql://nycdiscover:nycdiscover@127.0.0.1:5432/nycdiscover \
  npm run test:api

# Production web build and same-origin browser tests
npm run build
DATABASE_URL=postgresql://nycdiscover:nycdiscover@127.0.0.1:5432/nycdiscover \
SHARE_SIGNING_SECRET=local-only-secret npm run test:e2e

# Regenerate the TypeScript contract while FastAPI is on port 8000
npm run types:generate
```

GitHub Actions runs Node 22/npm 10, Python 3.12, PostgreSQL 16 integration tests, the Next.js build, and Playwright against `vercel dev -L`.

## Launch Runbook

Vercel Services is beta and available to approved Hobby projects. Docker remains the portability fallback. Do not purchase a plan or switch architectures if Services access is unavailable.

1. Provision Neon through the Vercel Marketplace in US East. Create `main` and `launch-preview` database branches and apply `npm run db:migrate` to both pooled URLs.
2. Configure Production as fixture-backed and noindex. With zero deployment history, run the guarded first deployment:

   ```bash
   ALLOW_FIXTURE_PRODUCTION_BOOTSTRAP=1 npm run bootstrap:vercel
   ```

3. Configure Preview for live data, `launch-preview` storage, Sentry, and Vercel protection. Deploy with `npm run preview:vercel`.
4. Validate Manhattan, Brooklyn, and Queens generation; current weather; city events; regeneration; sharing; map/keyboard behavior; Sentry delivery; and origin absence in PostgreSQL.
5. Point Production at the Neon `main` branch, enable indexing, and deploy the exact tested commit with `vercel --prod`.
6. Confirm `/api/healthz` reports `fixture_mode: false`, `database: postgres`, and `sharing_enabled: true` before connecting automatic Git production deployment.

The fixture bootstrap remains the immediate rollback target.

## Product Boundaries

Version one is guest-only, NYC-only, and current-day-only. It has no accounts, saved-plan dashboard, payments, route geometry, custom domain, or native-app launch. Costs and travel times are estimates; opening hours and availability should be verified before leaving.
