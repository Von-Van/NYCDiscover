# The daily neighborhood field guide

NYC Discover is a guest-only guide to an outing today in New York. The front page starts with a borough or neighborhood, then offers up to three feasible discoveries. Choosing one makes it a required centerpiece; generation checks it again against current provider results.

## Four acceptance stages

1. **Local knowledge and daily relevance:** validate the 30-place collection, all five boroughs, source dates, explicit closures, organizer-backed recurring markets, fixed starts, drop-in windows, and weather during each visit.
2. **Today's edition:** check the compact brief, reachable starts within two hours, verified free admission, required centerpieces, factual titles and introductions, registration notices, and the full brief editor.
3. **Session discovery:** check Easy favorites / Something new / Surprise me, keeping and unlocking stops, visited feedback, dismissals, depleted pools, optional prompts, session restore/reset, and blocked storage. Surprise changes ranking within the same practical constraints.
4. **On the sidewalk:** start an outing, complete stops in order, request a replacement from the last confirmed stop or an edited origin, and verify the original deadline and remaining per-person allowance. Check directions, optional feedback, native sharing/copy, old snapshots, and the dated edition.

## Reviewed content

`services/api/app/content/places.v1.json` contains six places per borough. Entries separate evergreen description/activity from prices, hours, closure exceptions, and recurring schedules. Every record has official source links, location, stable ID, and review dates. No images are used, so no undocumented image licenses are needed.

```sh
npm run content:validate
# Audit the collection at a future New York date:
npm run content:validate -- 2026-10-22
```

The command exits nonzero and lists entries needing attention. Evergreen writing expires after 90 days. Recurring schedules expire after 30 days or their published season end, whichever comes first. Operational prices/hours have a separate 30-day review. Expired records are withheld until reviewed; they are never silently re-dated. Provider venues may still appear with their own source information. Closures apply to identified duplicate venues too.

Use `provider_ids` for explicit provider identities when available. Otherwise deduplication requires matching names and locations within 0.12 miles. Events retain their separate identities. A known venue does not imply that an event there is free or has the same access rules.

Before advancing review dates, open each listed source and check description, access, price, hours, special closures, and schedule. For recurring events, use the organizer's current listing; do not infer a schedule from a venue's opening hours. Review unknown values as unknown. Run content validation and the API tests after editing.

## API and timing

- `POST /v1/discovery/today` takes the existing planning brief, including optional discovery/session fields, and returns cards with candidate IDs, descriptions, source links, price status, visit timing, schedule type, daily reasons, generated-at time, weather, warnings, and fixture/live mode.
- `POST /v1/itineraries/generate` accepts optional `centerpiece_id`, `discovery_mode`, and seen/visited/excluded/locked candidate IDs. A missing or infeasible required stop yields a conflict explanation rather than silently replacing it.
- `POST /v1/itineraries/remix` verifies the existing generation and brief with `swap_token`, then fetches fresh provider data. It returns the effective brief and newly signed generation. `completed_candidate_ids` must be a prefix of the selected plan. Completed public stop details stay fixed; completed allowances are deducted from the remaining budget. The effective brief retains the original outing deadline across subsequent replans.
- Snapshot-only Additional Options retain their one-hour token lifetime. Fresh-data remix accepts a valid signature for up to 24 hours, requires the same New York date, enforces the original deadline, and issues fresh signatures. Unexpired older signatures and stored shares still validate with additive defaults.

Dates use `America/New_York`, including visitors in other device timezones. Elapsed-minute arithmetic crosses daylight-saving transitions correctly. Same-day planning ends by New York midnight. Unknown opening hours remain unconfirmed; supported provider hours, explicit closures, event deadlines, budgets, radius, and weather remain constraints. Directions use public Google Maps URLs; map and travel estimates are not live routing.

## Privacy and operations

SessionStorage holds the current tab's mode, seen/visited/dismissed places, kept stops, and outing progress. Memory is the fallback. The session resets with the New York date or the reset control. Shared generations omit session feedback, completion state, candidate pools, signatures, private discovery controls, and origin labels/coordinates. The existing public shared brief remains compatible with older clients. Editorial copy uses public stop facts.

Aggregate analytics send only fixed event names for discovery selection, generation success, outing starts, and voluntary feedback. They carry no locations, candidate IDs, or session history. No database tables, accounts, paid feeds, calendar integrations, or runtime AI were added. Existing PostgreSQL caching, throttling, rate limits, and seven-day share storage are reused.

## Preview and production

Use the repository's existing `npm run preview:vercel` workflow. It refuses a first deployment that Vercel would promote to Production. Validate each of the four acceptance stages on Preview before promoting that exact deployment. Record the current production deployment URL before promotion, and retain it for rollback. Do not promote a fixture build as a live experience: the UI deliberately labels fixture editions and sample plans.

Required checks:

```sh
npm run content:validate
npm run lint
npm test
npm run test:api
# An isolated disposable database only: this suite truncates test tables.
TEST_DATABASE_URL=postgresql://... npm run test:api
npm run build
# With the combined fixture runtime, or a running web/API pair:
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
```

Browser coverage runs desktop and Pixel 7 layouts, keyboard selection, reduced motion, session restoration, blocked storage, the outing flow, and sharing. Existing hosted-only smoke checks require `PLAYWRIGHT_SHARED_PATH`; they are intentionally skipped otherwise. Live provider availability is variable, so Preview also needs a live-mode smoke check and source review before production.

## Preview verification — September 23, 2026

Verified Preview: https://nycdiscover-cugutuph3-von-vans-projects.vercel.app

- Health endpoint reports live mode, PostgreSQL, and sharing enabled.
- All 30 curated places validate across the five boroughs.
- Lint and the production build pass.
- Web unit tests: 34 passed. API tests with a disposable PostgreSQL database: 117 passed.
- Full local browser suite: 14 passed, six intentional skips for desktop-only or externally supplied shared-page cases.
- Final live Preview: four desktop/mobile checks passed, covering discovery, kept centerpieces, regeneration, outing completion and replacement, session restore, dated sharing, and unavailable browser storage. The browser timezone was Asia/Tokyo and reduced motion was enabled for the outing flow.
- Visual review confirmed two-card editions fill their row and provider stops receive activity suggestions without replacing source descriptions.

Production has not been promoted. The participant evaluation below and staged production rollout remain outstanding.

## First public evaluation

Recruit five NYC locals and five visitors. Give each the same task: choose a starting neighborhood and find an appealing outing for today, without explaining the controls. Start timing after location selection. Record only participant category (local/visitor), time to a chosen plan, whether they found one within 60 seconds, and optional comments. Target eight of ten within a minute.

After the outing, ask whether they went and whether they discovered somewhere new. Capture unclear reasons, impractical timing, surprise that felt unwelcome, and missing neighborhood knowledge. Fix those findings in the relevant acceptance stage and validate on Preview again. This is a human evaluation protocol, not a completed research claim.
