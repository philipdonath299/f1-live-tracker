const BASE = 'https://api.openf1.org';
const cache = new Map();
let token;
let authentication;
let queue = Promise.resolve();
let starts = [];
let cooldownUntil = 0;
export class ApiError extends Error {
  constructor(message, status = 502, retryAfter = 10) { super(message); this.status = status; this.retryAfter = retryAfter; }
}
export const liveConfigured = () => Boolean(process.env.OPENF1_TOKEN || (process.env.OPENF1_USERNAME && process.env.OPENF1_PASSWORD));
export async function getToken() {
  if (process.env.OPENF1_TOKEN) return process.env.OPENF1_TOKEN;
  if (!process.env.OPENF1_USERNAME || !process.env.OPENF1_PASSWORD) return null;
  if (token && token.expires > Date.now() + 60000) return token.value;
  if (authentication) return authentication;
  authentication = (async () => {
    const response = await fetch(`${BASE}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: process.env.OPENF1_USERNAME, password: process.env.OPENF1_PASSWORD }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new ApiError('OpenF1 sign-in failed. Check your subscribed account in the Vercel environment settings.', 401);
    const data = await response.json();
    if (!data.access_token) throw new ApiError('OpenF1 did not return an access token.', 502);
    token = { value: data.access_token, expires: Date.now() + Number(data.expires_in || 3600) * 1000 };
    return token.value;
  })().finally(() => { authentication = null; });
  return authentication;
}
async function slot() {
  const job = queue.catch(() => {}).then(async () => {
    const now = Date.now();
    if (cooldownUntil > now) throw new ApiError('OpenF1 is rate limiting requests. Retrying shortly.', 429, Math.ceil((cooldownUntil - now) / 1000));
    starts = starts.filter(t => t > now - 60000);
    if (starts.length >= (liveConfigured() ? 56 : 27)) throw new ApiError('Data request budget reached. Playback will resume shortly.', 429, Math.ceil((starts[0] + 61000 - now) / 1000));
    const delay = Math.max(0, (starts.at(-1) || 0) + 380 - now);
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    starts.push(Date.now());
  });
  queue = job;
  return job;
}
export async function cached(key, ttl, loader) {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.promise;
  const promise = loader().catch(error => { cache.delete(key); throw error; });
  cache.set(key, { promise, expires: Date.now() + ttl });
  if (cache.size > 180) {
    for (const [k, value] of cache) if (value.expires < Date.now()) cache.delete(k);
    if (cache.size > 180) cache.delete(cache.keys().next().value);
  }
  return promise;
}
export async function openf1(endpoint, params = {}, ttl = 10000) {
  const url = new URL(`/v1/${endpoint}`, BASE);
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, String(value));
  return cached(url.href, ttl, async () => {
    const access = await getToken();
    await slot();
    const response = await fetch(url, { headers: access ? { Authorization: `Bearer ${access}` } : {}, signal: AbortSignal.timeout(25000) });
    if (response.status === 401 || response.status === 403) {
      token = null;
      throw new ApiError(liveConfigured() ? 'OpenF1 rejected live access. Check your subscription and credentials.' : 'Live timing needs an OpenF1 subscription. Add OPENF1_USERNAME and OPENF1_PASSWORD in Vercel, or select a completed session for free replay.', 401);
    }
    if (response.status === 429) {
      const retry = Math.min(120, Math.max(10, Number(response.headers.get('retry-after')) || 30));
      cooldownUntil = Date.now() + retry * 1000;
      throw new ApiError('OpenF1 rate limit reached. Waiting before retrying.', 429, retry);
    }
    if (!response.ok) throw new ApiError(`OpenF1 ${endpoint} is temporarily unavailable (${response.status}).`, 502);
    const data = await response.json();
    if (!Array.isArray(data)) throw new ApiError(`Unexpected response from OpenF1 ${endpoint}.`, 502);
    return data;
  });
}
