export const ms = value => Date.parse(value);
export const validTime = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
export function lapTime(value) {
  if (!validTime(value)) return '—';
  const total = Math.round(value * 1000);
  return `${Math.floor(total / 60000)}:${String(Math.floor(total / 1000) % 60).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`;
}
export function gapTime(value) {
  if (value == null) return '—';
  return typeof value === 'number' ? `+${value.toFixed(3)}` : String(value);
}
export function modeFor(s, now = Date.now()) {
  if (s.is_cancelled) return 'cancelled';
  if (now < ms(s.date_start)) return 'upcoming';
  if (now <= ms(s.date_end)) return 'live';
  return 'replay';
}
const rowKey = (name, r) => name === 'laps' ? `${r.driver_number}:${r.lap_number}` : name === 'stints' ? `${r.driver_number}:${r.stint_number}` : name === 'session_result' ? r.driver_number : `${r.driver_number || ''}:${r.date}:${r.message || r.recording_url || ''}`;
export function mergeData(previous, incoming) {
  const result = { ...previous };
  for (const [name, rows] of Object.entries(incoming)) {
    if (!Array.isArray(rows) || name === 'issues') continue;
    const map = new Map((previous[name] || []).map(r => [rowKey(name, r), r]));
    for (const row of rows) map.set(rowKey(name, row), row);
    result[name] = [...map.values()].sort((a, b) => (ms(a.date || a.date_start) || 0) - (ms(b.date || b.date_start) || 0));
  }
  return result;
}
export function latestByDriver(rows = [], time, field = 'date') {
  const result = {};
  for (const row of rows) if (ms(row[field]) <= time && (!result[row.driver_number] || ms(row[field]) >= ms(result[row.driver_number][field]))) result[row.driver_number] = row;
  return result;
}
export function deriveTiming(data, drivers, time, isRace, final = false) {
  const positions = latestByDriver(data.position, time);
  const intervals = latestByDriver(data.intervals, time);
  const lapsByDriver = {};
  for (const lap of data.laps || []) if (ms(lap.date_start) <= time) (lapsByDriver[lap.driver_number] ||= []).push(lap);
  const results = Object.fromEntries((final ? data.session_result || [] : []).map(r => [r.driver_number, r]));
  const rows = drivers.map(driver => {
    const n = driver.driver_number;
    const started = (lapsByDriver[n] || []).sort((a, b) => a.lap_number - b.lap_number);
    const completed = started.filter(l => validTime(l.lap_duration) && ms(l.date_start) + l.lap_duration * 1000 <= time);
    const best = completed.filter(l => !l.is_pit_out_lap).reduce((v, l) => Math.min(v, l.lap_duration), Infinity);
    const last = completed.at(-1);
    const current = started.at(-1);
    const sectors = [];
    const sectorLap = current && time < ms(current.date_start) + (current.lap_duration || Infinity) * 1000 ? current : last;
    let sectorEnd = ms(sectorLap?.date_start);
    for (let i = 1; i <= 3; i++) {
      const value = sectorLap?.[`duration_sector_${i}`];
      sectorEnd += validTime(value) ? value * 1000 : Infinity;
      sectors.push(sectorEnd <= time ? value : null);
    }
    const stint = (data.stints || []).filter(s => s.driver_number === n && s.lap_start <= (current?.lap_number || 0)).sort((a, b) => b.stint_number - a.stint_number)[0];
    const pits = (data.pit || []).filter(p => p.driver_number === n && ms(p.date) <= time);
    const recentPit = pits.at(-1);
    const pitDuration = recentPit?.lane_duration ?? recentPit?.pit_duration;
    return { ...driver, position: results[n]?.position ?? positions[n]?.position ?? null,
      result: results[n], completed, currentLap: current?.lap_number ?? null,
      lastLap: last?.lap_duration ?? null, bestLap: Number.isFinite(best) ? best : null, sectors,
      gap: intervals[n]?.gap_to_leader ?? null, interval: intervals[n]?.interval ?? null,
      compound: stint?.compound, tyreAge: stint && last ? Math.max(0, last.lap_number - stint.lap_start + 1) + (stint.tyre_age_at_start || 0) : null,
      pitCount: pits.length, inPit: recentPit && validTime(pitDuration) && time < ms(recentPit.date) + pitDuration * 1000 };
  });
  rows.sort((a, b) => isRace || final ? (a.position ?? 999) - (b.position ?? 999) : (a.bestLap ?? Infinity) - (b.bestLap ?? Infinity) || (a.position ?? 999) - (b.position ?? 999));
  const fastest = Math.min(...rows.map(r => r.bestLap ?? Infinity));
  if (!isRace) for (const row of rows) row.gap = row.bestLap != null && Number.isFinite(fastest) ? row.bestLap - fastest : null;
  return { rows, fastest: Number.isFinite(fastest) ? fastest : null, lap: Math.max(0, ...rows.map(r => r.currentLap || 0)) };
}
export function groupSamples(rows = []) {
  const groups = {};
  for (const r of rows) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || (r.x === 0 && r.y === 0)) continue;
    (groups[r.driver_number] ||= []).push({ ...r, t: ms(r.date) });
  }
  for (const list of Object.values(groups)) list.sort((a, b) => a.t - b.t);
  return groups;
}
export function sampleAt(samples, time, maxAge = 10000) {
  if (!samples?.length) return null;
  let low = 0, high = samples.length;
  while (low < high) { const mid = (low + high) >>> 1; if ((samples[mid].t ?? ms(samples[mid].date)) <= time) low = mid + 1; else high = mid; }
  const a = samples[low - 1];
  if (!a || time - (a.t ?? ms(a.date)) > maxAge) return null;
  const b = samples[low];
  if (!b || b.t - a.t > 3000 || !Number.isFinite(a.x)) return a;
  const f = (time - a.t) / (b.t - a.t || 1);
  // Never interpolate across GPS teleports or a pit garage jump.
  if (Math.hypot(b.x - a.x, b.y - a.y) > 2000) return a;
  return { ...a, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
