# Free Formula 1 data audit

Reviewed 31 October 2026. This is an audit of useful public sources, not a claim that every F1 API on the internet is included. A provider advertising a free API does not mean every live topic is free or currently published.

| Source | Free coverage | Live? | How the tracker uses it |
| --- | --- | --- | --- |
| F1 public SignalR Core stream | Public classification, timing, gaps, sectors, mini-sectors, tyres, pit counts, weather, flags | During published sessions, subject to provider access | Native browser WebSocket, JSON Hub Protocol, sparse-patch merge and reconnect; no credentials |
| F1 public HTTP transport | Public F1 timing topics over standard SignalR Long Polling | When anonymous access and Long Polling are offered | Bounded serverless connection, normal affinity cookies, handshake, subscription, keyframe, cleanup |
| F1Dash public WebSocket | Complete timing states from an independent public dashboard | During active sessions | Bounded read from the source project's documented `/ws` endpoint |
| F1 Dash public state | Another public timing snapshot service | Conditional on current service availability | Independent fallback through its published `/api/current` endpoint |
| F1 Insights community API | Public timing snapshots and whichever radio, telemetry and position topics its server actually receives | Conditional; upstream age and phase checked | Automatic free fallback; fixed public snapshot endpoint, cached for 8 seconds |
| Jolpica | Schedules, circuits, driver/team standings, points, wins, race results, qualifying and fastest-lap fields | Published statistics, not live car timing | Calendar fallback plus Championship view; 5-minute caching, 350ms request spacing and identifying user agent |
| MultiViewer | Circuit points and rotation | Geometry only | Exact circuit key and year; never substituted for GPS |
| OpenF1 | Historical sessions, timing, telemetry, GPS, radio and weather | Paid for live access | Existing historical replay; optional subscribed live mode retained, not required for the default page |
| T1API | Public reference data; analysis tier requires an account/API key | Not a complete anonymous live source | Documented in Data sources; not silently treated as a free live feed |
| When's the Race | Public schedule JSON | Schedule only | Documented supplementary option; the app uses Jolpica for its calendar |

## Access findings

F1 Sensor's maintainer tested public live timing without a token during 23-25 October 2026. Classification, timing, tyres, weather, session state and race control arrived without an account. Their tested free account did not receive live GPS or car telemetry; the tested paid account did. This is observed coverage, not a guarantee for every session or country. FastF1 3.9 also documents newly required authentication for archive endpoints in October 2026.

The default connection subscribes to public timing topics. If anonymous access is rejected, the app marks that connection unavailable and checks the independent community feed. Optional OpenF1 credentials stay on the separate server-side provider path.

## What the map means

Fresh, timestamped position samples take precedence. When no live GPS is available, the optional **Timing estimate** projects completed mini-sectors onto the circuit's measured outline. It is an approximate spatial estimate, not actual GPS. Sector lengths are not known, so it cannot locate a car precisely. The map permanently labels this mode **TIMING ESTIMATE / NOT GPS**. The estimate only changes when the published completion data changes; there is no invented speed or looping car animation. Pit-lane, retired and stopped cars are excluded from the estimate. Turn the checkbox off to show only recorded GPS.

## Freshness and source matching

- The upstream event/heartbeat timestamp determines freshness. HTTP fetch time never makes an old snapshot live.
- Completed sessions remain labelled complete; disconnected or stale feeds are not labelled live.
- Session changes clear timing, lap history, radio and GPS. Driver/circuit identity is retained only within the same weekend.
- GPS enrichment is only allowed for the identical session key and fresh samples.
- Live lap history includes observed lap/time pairs, not invented laps before the page connected.
- Missing data is shown as missing. A connection alone does not guarantee free GPS, telemetry or radio.

## Primary references

- F1 Sensor access observations: https://nicxe.github.io/f1_sensor/beta/features/f1tv-auth
- FastF1 live client: https://github.com/theOehrly/Fast-F1/blob/main/fastf1/livetiming/client.py
- FastF1 recent authentication changes: https://github.com/theOehrly/Fast-F1/releases
- Community feed API and schema: https://github.com/harsh779/f1-live-api
- Jolpica API and rate limits: https://github.com/jolpica/jolpica-f1/tree/main/docs
- OpenF1 coverage: https://openf1.org/docs/
- T1API access tiers: https://docs.t1f1.com/
- Supplementary schedule: https://whenstherace.com/f1-schedule-json/

Run `node scripts/check-free-sources.mjs` for a current read-only provider check. The GitHub workflow runs it as a diagnostic after the deterministic tests/build. Availability failures do not turn fixtures into live data or fail an otherwise valid static build.

The browser performs the standard OPTIONS/POST negotiation before opening the SignalR connection ID. A serverless HTTP fallback is used where browser CORS or WebSocket transport is unavailable. Each provider rejection remains visible. On the first deployment audit the original community host returned 503 and the cloud-side WebSocket probe failed; those results triggered the additional transport and provider fallbacks. This is not evidence of universal free availability.
