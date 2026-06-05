# NYC Discover

NYC Discover turns a free block of time into a small, practical same-day itinerary. The MVP combines nearby places, city events, weather, transparent estimates, and a bounded itinerary search rather than returning another long list.

## Stack

- `apps/web`: Next.js, React, Tailwind CSS, MapLibre
- `apps/ios`: SwiftUI, MapKit, Core Location
- `services/api`: FastAPI, Python
- PostgreSQL: provider-response cache only

Fixture mode is enabled by default, so the complete input-to-itinerary flow works without API keys or live network calls.

## Quick Start

1. Copy the environment file:

   ```bash
   cp .env.example .env
   ```

2. Start PostgreSQL:

   ```bash
   docker compose up postgres -d
   ```

3. Start the API:

   ```bash
   cd services/api
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements-dev.txt
   uvicorn app.main:app --reload --env-file ../../.env
   ```

4. Start the web app in a second terminal:

   ```bash
   npm install
   set -a; source .env; set +a
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000). The API docs are available at [http://localhost:8000/docs](http://localhost:8000/docs).

## iPhone App

The native iPhone app lives at `apps/ios/NYCDiscover.xcodeproj`. It mirrors the browser MVP: location search/current location, same-day constraints, mood/transport/radius controls, itinerary generation, demo fallback, weather/warnings, plan switching, timeline details, and a MapKit route preview.

To run it:

```bash
open apps/ios/NYCDiscover.xcodeproj
```

Choose the `NYCDiscover` scheme and an iPhone simulator in Xcode. The app points to `http://127.0.0.1:8000` by default, so start the FastAPI service first if you want live local results. When the API is offline, the app uses the same Upper West Side demo fallback behavior as the web version.

For a physical iPhone, update `NYCDiscoverAPIURL` in `apps/ios/NYCDiscover/Resources/Info.plist` to your Mac's LAN URL and run the API bound to your network interface, for example:

```bash
cd services/api
uvicorn app.main:app --reload --env-file ../../.env --host 0.0.0.0
```

## Live Data

Set `FIXTURE_MODE=false` to enable live providers.

- Subscribe to the free Event Calendar product in the [NYC API Developers Portal](https://api-portal.nyc.gov/) and set `NYC_EVENT_CALENDAR_KEY`.
- Set a contactable `NYC_DISCOVER_USER_AGENT` before using Nominatim, Overpass, or the National Weather Service.
- Provider URLs are environment-configurable so the application can move away from public instances without a code release.

Live requests are rate-limited and cached. If a provider fails, the API uses a stale cache entry when possible and returns a warning instead of failing the entire itinerary request.

## Commands

```bash
# Backend tests that exercise the recommendation engine and provider cache
cd services/api && pytest

# Frontend unit tests
npm test

# Build and lint
npm run build
npm run lint

# iPhone simulator build
xcodebuild -project apps/ios/NYCDiscover.xcodeproj -scheme NYCDiscover -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath apps/ios/DerivedData build

# Generate the TypeScript OpenAPI contract while the API is running
npm run types:generate
```

## Product Boundaries

The MVP is guest-only, NYC-only, and current-day-only. Budgets and cost totals are estimated per person. Travel legs are mode-aware estimates, not turn-by-turn routes. Missing price and duration details are always labeled as estimates and reduce confidence.
