# TrustCars Self-Hosted Maps Plan (Step by Step, 8 GB RAM)

## Goal

Replace Google Maps services in TrustCars with a self-hosted stack that can support:

- map rendering
- place search
- reverse geocoding
- route drawing
- road distance
- ETA

This plan assumes:

- one server
- about `8 GB RAM`
- SSD storage
- initial focus on `Zimbabwe`

## Best Starting Stack

Use:

- `MapLibre` for map rendering in the app
- `OpenStreetMap` data
- `OSRM` for routing and ETA
- `Nominatim` for place search and reverse geocoding
- a lightweight tile server for map tiles

Do not start with:

- full world data
- advanced multi-engine routing
- complex custom tile pipelines

## Recommended Deployment Scope

For this app, the best practical first scope is:

- `Zimbabwe-only`

If you want an even lighter start:

- `Bulawayo + Harare` area first

Zimbabwe-only is the better balance because TrustCars is not just a static map app, it is a ride-hailing app and routes can cross cities.

## Server Requirements

Recommended minimum:

- `8 GB RAM`
- `4 vCPU` preferred
- `100 GB SSD` minimum
- `Ubuntu 22.04` or similar Linux server

## Architecture

### On the same server

Run:

- TrustCars backend API
- `OSRM`
- `Nominatim`
- tile server

This is acceptable for phase 1.

### Later, when traffic grows

Split into:

- app/API server
- map/search/routing server

## Step 1: Start With Routing First

Before trying to replace everything, replace directions first.

Why:

- ride-hailing depends heavily on route distance and ETA
- you already have server endpoints for directions
- this gives the biggest cost-saving and control win first

Use:

- `OSRM`

Outcome:

- `/api/maps/directions` points to your own routing server
- driver and passenger route distance becomes self-hosted

## Step 2: Keep the Frontend Contract Stable

Do not rewrite the app flow first.

Keep these routes in your backend:

- `/api/maps/directions`
- `/api/maps/places/autocomplete`
- `/api/maps/places/details`

Then change only the provider behind them.

This keeps:

- mobile code changes smaller
- admin/web changes smaller
- rollout easier to test

## Step 3: Set Up OSRM

### What OSRM will do

- route geometry
- route distance
- route duration
- ETA basis

### OSRM setup flow

1. Download Zimbabwe OSM extract.
2. Prepare OSRM profile for driving.
3. Run extraction.
4. Run partition/customize or contract depending on chosen mode.
5. Start `osrm-routed`.

### Notes

- OSRM is the easiest strong starting point for TrustCars
- keep the routing profile focused on driving only

## Step 4: Set Up Nominatim

### What Nominatim will do

- address search
- reverse geocoding
- place lookup

### Nominatim setup flow

1. Use the same Zimbabwe OSM extract.
2. Import the extract into PostgreSQL/PostGIS.
3. Configure Nominatim API endpoints.
4. Add result filtering for app-friendly responses.

### Important note for 8 GB RAM

Nominatim can run on 8 GB, but keep the dataset small and tune expectations.

Good fit:

- Zimbabwe

Bad fit for this server size:

- very large regional imports

## Step 5: Set Up Tiles

### What the tile server will do

- background map display
- roads, boundaries, labels

### Best first approach

Use:

- pre-generated tiles
- simple tile serving

Do not start with a fully custom rendering pipeline unless you really need it.

### Good phase-1 objective

- stable map rendering
- acceptable zoom levels
- city navigation visibility
- low operational overhead

## Step 6: Replace the Mobile Map Renderer

Replace Google rendering with:

- `MapLibre React Native`

### Do this in stages

1. Replace passenger map rendering.
2. Replace driver map rendering.
3. Replace any admin/web Google map rendering later if needed.

### Important

Do not combine:

- new tile hosting
- new routing
- new geocoding
- new mobile UI behavior

all in one release.

Change one layer at a time.

## Step 7: Wire TrustCars Backend to the Self-Hosted Services

### Directions

Update the backend directions layer so:

- `/api/maps/directions` calls `OSRM`

### Places

Update the backend places layer so:

- `/api/maps/places/autocomplete` calls your geocoder/search service
- `/api/maps/places/details` resolves selected places cleanly

### Reverse geocoding

Use Nominatim for:

- location labels
- pickup labels
- drop-off labels

## Step 8: Add Caching

Because we are on one `8 GB` server, caching matters.

Add caching for:

- repeated route requests
- repeated reverse geocoding
- repeated place lookups

Good cache targets:

- same pickup/drop-off area
- repeated driver route recalculations
- popular city landmarks

## Step 9: Tune for TrustCars Ride Flows

The system must work well for:

- passenger booking
- driver incoming requests
- driver trip navigation
- live ETA refresh

### Minimum checks

Test:

- pickup search quality
- drop-off search quality
- route quality
- route ETA
- reverse geocode label quality
- map speed on driver screen

### Especially test

- Bulawayo
- Harare
- airport routes
- CBD routes
- low-signal mobile network conditions

## Step 10: Migration Order

Use this exact order:

1. Keep the current app screens.
2. Replace backend directions with `OSRM`.
3. Test all route flows.
4. Replace geocoding/search with `Nominatim`.
5. Test pickup and drop-off search thoroughly.
6. Replace frontend map rendering with `MapLibre`.
7. Add self-hosted tiles.
8. Optimize caches and memory usage.

This is the safest order.

## Step 11: Rollout Strategy

### Phase 1

Self-host only routing first.

Why:

- lowest risk
- easiest to measure
- biggest immediate value

### Phase 2

Move place search and reverse geocoding.

### Phase 3

Move map rendering and tiles.

### Phase 4

Optimize performance and split services only if needed.

## Step 12: Monitoring

Track:

- routing response time
- geocoding response time
- tile response time
- RAM usage
- CPU usage
- disk usage
- import/update times

You especially want alerts for:

- routing service down
- DB disk nearly full
- high RAM pressure

## Step 13: Data Update Plan

OpenStreetMap data changes.

So define a refresh plan:

- monthly at minimum
- weekly if operations change often

Keep updates simple at first:

1. download new extract
2. rebuild OSRM data
3. refresh Nominatim data on maintenance window
4. restart services cleanly

## Step 14: Risks

Main risks:

- place search quality not as polished as Google
- route quality depends on OSM road data
- single-server bottlenecks
- Nominatim import complexity

## Step 15: Risk Reduction

Do this to reduce risk:

- start with Zimbabwe-only
- migrate directions first
- keep backend API contract stable
- cache aggressively
- test all ride flows before full cutover
- do not migrate every map-related subsystem at once

## Recommended Practical Plan for You Right Now

Because you now have `8 GB RAM`, this is the plan I recommend:

### First

Set up:

- `OSRM`

Use it for:

- route geometry
- driver-to-pickup distance
- pickup-to-drop-off distance
- ETA

### Second

Set up:

- `Nominatim`

Use it for:

- search
- reverse geocoding

### Third

Move app rendering to:

- `MapLibre`

### Fourth

Host your own tiles.

## Final Recommendation

If you want the safest and smartest path for TrustCars on `8 GB RAM`, do this:

1. self-host `OSRM` first
2. self-host `Nominatim` second
3. move UI maps to `MapLibre`
4. self-host tiles after that

That gives you:

- better control
- lower long-term map API cost
- a realistic deployment for your current server size
- the least risky migration path

## Short Version

Best self-hosted TrustCars plan on 8 GB:

- `MapLibre`
- `OpenStreetMap`
- `OSRM`
- `Nominatim`
- Zimbabwe extract
- one-server phase 1
- split services later only if traffic grows
