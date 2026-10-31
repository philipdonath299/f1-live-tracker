# F1 Live - your free pit wall

The default view now uses **free live timing without an OpenF1 subscription or API key**. It connects to F1's public timing stream in your browser and checks an independent public community feed as a fallback. No live values are generated when the providers are unavailable.

Open the site and select **Free live**. Auto mode chooses a fresh free source. The source menu also lets you select F1 public timing or the community feed directly. **Data sources** explains the coverage and current connection state.

## Features

- Live classification, gaps, intervals, last/best laps, sector times and mini-sectors.
- Tyre compound/age, published pit counts, pit/retirement/qualifying status and speed traps.
- Weather, race control and track status; radio when the free source publishes it.
- Select and follow a driver on the correct circuit. Fresh recorded GPS takes precedence. When GPS is unavailable, the optional **Timing estimate** shows approximate mini-sector progress and is clearly labelled **not GPS**. It never runs simulated cars around a lap.
- Championship view with free driver/team standings, points, wins, latest race classification, fastest laps and qualifying times, provided by Jolpica.
- Calendar fallback through Jolpica if OpenF1 is restricted.
- Existing OpenF1 historical replay: play, pause, seek, 0.5x/1x/2x playback, GPS, telemetry, lap history and published radio.
- A completed, stale or disconnected source is explicitly distinguished from a current live session.

Live GPS and full car telemetry are not guaranteed free. Public timing can be partial or restricted for a particular session; the community host can sleep or be unavailable. The app only displays data its selected source actually delivers. [Free source audit](docs/free-data-sources.md) contains the research, coverage and limitations.

## Run and verify

Use Node.js 22 or later. There are no third-party runtime dependencies.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Opening index.html directly does not start the API.

```sh
npm test
npm run build
node scripts/check-free-sources.mjs
```

Tests cover both live transports, patch/keyframe handling, free-mode startup, free statistics, source freshness, source/session matching, missing data, timing-based map estimates, private authentication, replay and late session responses. Tests never substitute their fixtures into the public app. The source check performs optional real provider requests and reports what is currently reachable; it does not guarantee an active session.

## Deploy to Vercel

Push to the connected GitHub repository. The included vercel.json selects **Other**, build command `npm run build`, output `dist`, and a Node function at `api/f1.js`. Commit `api/` and `server/` with the client; deploying only dist does not include the API.

**No environment variables are needed for free live mode.**

OpenF1 subscription credentials remain optional for its separate live provider. If you choose to use it, set `OPENF1_USERNAME` and `OPENF1_PASSWORD` in Vercel and redeploy. Local development can use `.env` copied from `.env.example`. Authentication and token renewal occur on the server. Credentials and bearer tokens are never returned to the browser or sent to the free providers. `OPENF1_TOKEN` is an optional temporary alternative and does not auto-renew.

## Implementation

The page loads `js/pitwall.js`, the `js/free-*.js` modules, historical timing/map modules and `css/pitwall.css`. Older scripts in the repository are not loaded or included in fresh production builds. Vercel functions use native fetch; free live streaming uses a native browser WebSocket, so it does not need a permanent server process or a paid WebSocket host.

The proxy uses fixed provider URLs, bounded queries, caching, request deduplication, timeouts and rate-limit backoff. Jolpica data is cached for five minutes and requests are spaced below its published four-per-second burst limit within each warm instance. Source availability and limits can change.

Unofficial fan project. Not associated with Formula 1, FIA or the Formula 1 companies. Timing source attribution is displayed in the app.
