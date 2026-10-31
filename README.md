# F1 Live — your pit wall

A responsive Formula 1 timing dashboard backed by real OpenF1 data. No generated positions, invented gaps, mock drivers, or substitute tracks are used by the application.

- Timing tower: position, gap, interval, last and best laps, compounds, tyre age and pit stops.
- Circuit map matched by the selected session's circuit key and year. If MultiViewer geometry is unavailable, the server traces a completed clean lap from that exact session.
- Select a driver from the timing tower, driver menu or map. Follow, zoom, fit and toggle labels.
- Driver telemetry: speed, gear, RPM, DRS, throttle, brake, sectors and lap history.
- Weather, race control, flags and playable published team radio clips.
- All published practice, qualifying, sprint and race sessions from 2023 onward.
- Historical replay with pause, seek and 0.5× / 1× / 2× playback. Timing, radio, weather, pit stops and positions follow the replay clock. Final classifications appear at the session end.
- Live timing refreshes every 10 seconds; GPS/selected-driver telemetry polls every 4 seconds. Positions play approximately 6 seconds behind the local clock to interpolate recorded GPS samples. Provider latency is additional.

## Run locally

Use Node.js 22 or later. There are no third-party runtime dependencies.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. The local server includes the same API used on Vercel. Opening index.html directly or using a static-only server does not run the API.

```sh
npm test
npm run build
```

## Deploy from GitHub to Vercel

1. Commit the source files to https://github.com/philipdonath299/f1-live-tracker using HTTPS (an SSH key is unnecessary).
2. Import that GitHub repository in Vercel, or push to the production branch if it is already connected.
3. Choose **Other** as the framework, `npm run build` as the build command, and `dist` as the output directory. The included vercel.json sets these automatically.
4. Deploy. Vercel builds the static client and separately deploys `api/f1.js` as a Node function. Include both `api/` and `server/` in the repository; uploading only `dist/` will not work.

Historical sessions work without credentials. Live sessions require your own paid OpenF1 subscription. In Vercel's project **Settings → Environment Variables**, add:

```text
OPENF1_USERNAME=your subscribed OpenF1 username
OPENF1_PASSWORD=your OpenF1 password
```

Redeploy after changing the environment variables. For local development, copy `.env.example` to `.env` and fill in the credentials. Never commit `.env`. Username/password authentication happens exclusively on the server, with access-token renewal. The browser receives data and a configuration flag, never credentials or bearer tokens. `OPENF1_TOKEN` is an alternative for temporary testing, but expires and does not auto-renew.

OpenF1 documentation: https://openf1.org/docs/ and https://openf1.org/auth.html

## Data behavior

The API applies bounded telemetry queries, an allowlisted set of resources, request caching, in-flight deduplication, timeouts and rate-limit backoff. Its request budget is shared within each warm function instance. OpenF1 can impose additional limits across instances or viewers. An unavailable feed produces a visible notice and missing values; the client does not switch to simulated data. Radio is limited to clips the provider publishes. GPS is approximate, not a representation of lateral placement on the track. Canceled and upcoming sessions are distinct from live sessions.

The application uses `index.html`, `css/pitwall.css`, and the `js/pitwall*.js` modules. Older scripts are retained in the working folder, but are not referenced by the new page or copied into a fresh production build.

## Verification

The automated suite covers timestamp-synchronized lap and sector calculations, session phases, gaps, tyre age, pit stops, chronological merges, missing data, GPS interpolation/stale samples, controller selection and replay, late responses after session switching, API validation, private authentication, caching and partial provider failures. Test fixtures are isolated in `test/` and never served as real race data.

An actual live session and visual browser checks still need verification in an environment with provider access. GitHub upload and Vercel deployment are separate steps and must be confirmed by their respective services.

Unofficial fan project. Not affiliated with Formula 1, FIA, or the Formula 1 companies. Data: OpenF1. Circuit geometry: MultiViewer.
