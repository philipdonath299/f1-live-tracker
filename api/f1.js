import { openf1, cached, ApiError, liveConfigured } from '../server/openf1.js';
const columns = {
  position: ['date', 'driver_number', 'position'],
  intervals: ['date', 'driver_number', 'gap_to_leader', 'interval'],
  laps: ['date_start', 'driver_number', 'lap_number', 'lap_duration', 'duration_sector_1', 'duration_sector_2', 'duration_sector_3', 'is_pit_out_lap', 'st_speed'],
  stints: ['driver_number', 'stint_number', 'lap_start', 'lap_end', 'compound', 'tyre_age_at_start'],
  pit: ['date', 'driver_number', 'lap_number', 'pit_duration', 'lane_duration', 'stop_duration'],
  race_control: ['date', 'driver_number', 'category', 'flag', 'message', 'scope', 'sector', 'lap_number'],
  team_radio: ['date', 'driver_number', 'recording_url'],
  weather: ['date', 'air_temperature', 'track_temperature', 'humidity', 'rainfall', 'wind_speed', 'wind_direction'],
  session_result: ['driver_number', 'position', 'dnf', 'dns', 'dsq', 'number_of_laps', 'gap_to_leader', 'duration']
};
const compact = (name, rows) => rows.map(row => Object.fromEntries(columns[name].filter(k => row[k] != null).map(k => [k, row[k]])));
const integer = (value, min, max, name) => {
  if (!/^\d+$/.test(String(value)) || Number(value) < min || Number(value) > max) throw new ApiError(`Invalid ${name}.`, 400);
  return Number(value);
};
const session = key => cached(`session:${key}`, 60000, async () => {
  const rows = await openf1('sessions', { session_key: key }, 60000);
  if (!rows[0]) throw new ApiError('Session not found.', 404);
  return rows[0];
});
export function validateWindow(params, s, now = Date.now()) {
  const from = Date.parse(params.get('from'));
  const to = Date.parse(params.get('to'));
  const start = Date.parse(s.date_start) - 600000;
  const end = Math.min(now + 30000, Date.parse(s.date_end) + 600000);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 45000 || from < start || to > end) throw new ApiError('Invalid telemetry time window (maximum 45 seconds).', 400);
  return { 'date>': new Date(from).toISOString(), 'date<': new Date(to).toISOString() };
}
async function timing(s, since) {
  const live = Date.now() <= Date.parse(s.date_end) + 60000;
  const names = Object.keys(columns).filter(n => n !== 'session_result' || !live);
  const issues = [];
  const result = await Promise.all(names.map(async name => {
    try {
      const params = { session_key: s.session_key };
      if (live && since && !['stints', 'session_result'].includes(name)) {
        const cursor = Date.parse(since);
        if (!Number.isFinite(cursor)) throw new ApiError('Invalid timing cursor.', 400);
        params[name === 'laps' ? 'date_start>' : 'date>'] = new Date(Math.max(Date.parse(s.date_start), cursor - (name === 'laps' ? 300000 : 15000))).toISOString();
      }
      const fast = ['position', 'laps', 'intervals'].includes(name);
      const ttl = live ? (fast ? 9000 : 45000) : 3600000;
      if (live && !fast) delete params['date>'];
      return [name, compact(name, await openf1(name, params, ttl))];
    } catch (e) {
      issues.push({ stream: name, message: e.message, status: e.status || 502, retryAfter: e.retryAfter || 10 });
      return [name, []];
    }
  }));
  if (issues.length === names.length) throw new ApiError(issues[0].message, issues[0].status, issues[0].retryAfter);
  return { ...Object.fromEntries(result), issues, fetchedAt: new Date().toISOString() };
}
async function track(s) {
  return cached(`track:${s.session_key}`, 3600000, async () => {
    try {
      const response = await fetch(`https://api.multiviewer.app/api/v1/circuits/${s.circuit_key}/${s.year}`, { signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        const data = await response.json();
        const x = data.x || data.circuit?.x;
        const y = data.y || data.circuit?.y;
        if (Array.isArray(x) && Array.isArray(y) && x.length > 40 && x.length === y.length) {
          return { points: x.map((v, i) => ({ x: v, y: y[i] })), rotation: Number(data.rotation || 0), source: 'MultiViewer circuit geometry', circuitKey: s.circuit_key };
        }
      }
    } catch { /* Recover with a measured lap from this exact session. */ }
    const laps = await openf1('laps', { session_key: s.session_key }, 45000);
    const candidates = laps.filter(l => !l.is_pit_out_lap && l.lap_duration > 40 && l.lap_duration < 220 && l.date_start && Date.parse(l.date_start) + l.lap_duration * 1000 < Date.now())
      .sort((a, b) => a.lap_duration - b.lap_duration).slice(0, 3);
    for (const lap of candidates) {
      const rows = await openf1('location', { session_key: s.session_key, driver_number: lap.driver_number, 'date>': lap.date_start, 'date<': new Date(Date.parse(lap.date_start) + lap.lap_duration * 1000).toISOString() }, 3600000);
      const points = rows.filter(r => Number.isFinite(r.x) && Number.isFinite(r.y) && (r.x !== 0 || r.y !== 0)).sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).map(({ x, y }) => ({ x, y }));
      if (points.length > 60) return { points, rotation: 0, source: `Measured lap ${lap.lap_number} · car ${lap.driver_number}`, circuitKey: s.circuit_key };
    }
    throw new ApiError('Circuit geometry is not available yet. It will load once a clean lap is recorded.', 404);
  });
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.statusCode = 405; res.end(JSON.stringify({ error: 'Use GET.' })); return; }
  try {
    const p = new URL(req.url, 'http://localhost').searchParams;
    const action = p.get('action') || 'catalog';
    let data;
    if (action === 'catalog') {
      const year = integer(p.get('year') || new Date().getUTCFullYear(), 2023, new Date().getUTCFullYear() + 1, 'year');
      data = { sessions: await openf1('sessions', { year }, 60000), liveConfigured: liveConfigured(), serverTime: new Date().toISOString() };
    } else {
      const key = integer(p.get('session'), 1, 9999999, 'session');
      const s = await session(key);
      if (action === 'session') data = { session: s, drivers: await openf1('drivers', { session_key: key }, 600000), liveConfigured: liveConfigured() };
      else if (action === 'timing') data = await timing(s, p.get('since'));
      else if (action === 'track') data = await track(s);
      else if (action === 'stream') {
        const filters = { session_key: key, ...validateWindow(p, s) };
        const telemetryFilters = p.has('driver') ? { ...filters, driver_number: integer(p.get('driver'), 1, 999, 'driver') } : null;
        // Coalesce selected-car requests into 8-second windows while GPS updates every 4s.
        if (telemetryFilters && Date.now() >= Date.parse(s.date_start) && Date.now() <= Date.parse(s.date_end)) {
          const edge = Math.floor(Date.parse(telemetryFilters['date<']) / 8000) * 8000;
          telemetryFilters['date>'] = new Date(edge - 20000).toISOString();
          telemetryFilters['date<'] = new Date(edge).toISOString();
        }
        const issues = [];
        const request = async (name, params) => {
          try { return await openf1(name, params, 8000); }
          catch (e) { issues.push({ stream: name, message: e.message, status: e.status || 502, retryAfter: e.retryAfter || 10 }); return []; }
        };
        const [locations, telemetry] = await Promise.all([request('location', filters), telemetryFilters ? request('car_data', telemetryFilters) : []]);
        if (issues.length === (telemetryFilters ? 2 : 1)) throw new ApiError(issues[0].message, issues[0].status, issues[0].retryAfter);
        data = { locations, telemetry, issues, fetchedAt: new Date().toISOString() };
      } else throw new ApiError('Unknown data action.', 400);
    }
    res.statusCode = 200;
    res.end(JSON.stringify(data));
  } catch (error) {
    res.statusCode = error.status || 502;
    if (res.statusCode === 429) res.setHeader('Retry-After', String(error.retryAfter || 30));
    res.end(JSON.stringify({ error: error instanceof ApiError ? error.message : 'Unable to reach the data provider. Check the connection and try again.', retryAfter: error.retryAfter || 10 }));
  }
}
