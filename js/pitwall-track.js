import { sampleAt } from './pitwall-timing.js';
export class TrackMap {
  constructor(canvas, onSelect) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.onSelect = onSelect;
    this.points = []; this.samples = {}; this.drivers = []; this.selected = null;
    this.zoom = 1; this.follow = false; this.labels = true; this.rotation = 0; this.hits = [];
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('click', e => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const hit = this.hits.filter(p => Math.hypot(p.x - x, p.y - y) < 24).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
      if (hit) onSelect(hit.number);
    });
    this.resize();
  }
  resize() {
    const { width, height } = this.canvas.parentElement.getBoundingClientRect();
    this.width = width; this.height = height;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = width * dpr; this.canvas.height = height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  reset() { this.points = []; this.samples = {}; this.zoom = 1; this.selected = null; this.hits = []; }
  load(data) {
    this.rotation = Number(data.rotation || 0) * Math.PI / 180;
    this.points = data.points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).map(p => this.rotate(p));
    const xs = this.points.map(p => p.x), ys = this.points.map(p => p.y);
    this.bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    this.zoom = 1;
  }
  rotate(p) {
    const c = Math.cos(this.rotation), s = Math.sin(this.rotation);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
  }
  draw(time) {
    const c = this.ctx, w = this.width, h = this.height;
    c.clearRect(0, 0, w, h); this.hits = [];
    if (!this.points.length || !w || !h) return 0;
    const b = this.bounds;
    const scale = Math.min((w - 95) / Math.max(1, b.maxX - b.minX), (h - 80) / Math.max(1, b.maxY - b.minY)) * this.zoom;
    let center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    const selected = sampleAt(this.samples[this.selected], time);
    if (this.follow && selected) center = this.rotate(selected);
    const project = p => ({ x: w / 2 + (p.x - center.x) * scale, y: h / 2 - (p.y - center.y) * scale });
    c.lineCap = 'round'; c.lineJoin = 'round';
    const path = () => {
      c.beginPath();
      this.points.forEach((p, i) => { const q = project(p); if (!i) c.moveTo(q.x, q.y); else c.lineTo(q.x, q.y); });
      c.closePath();
    };
    path(); c.strokeStyle = '#080a0e'; c.lineWidth = 15; c.stroke();
    path(); c.strokeStyle = '#535b69'; c.lineWidth = 9; c.stroke();
    path(); c.strokeStyle = '#303640'; c.lineWidth = 5; c.stroke();
    // The first measured point marks the start/finish timing line.
    const start = project(this.points[0]);
    c.fillStyle = '#e3e6ef'; c.fillRect(start.x - 3, start.y - 6, 6, 12);
    c.font = '8px Consolas, monospace'; c.fillStyle = '#8e96a6'; c.fillText('S/F', start.x + 10, start.y + 3);
    const ordered = [...this.drivers].sort((a, b) => Number(a.driver_number === this.selected) - Number(b.driver_number === this.selected));
    let count = 0;
    for (const driver of ordered) {
      const sample = sampleAt(this.samples[driver.driver_number], time);
      if (!sample) continue;
      const r = this.rotate(sample);
      const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * .1;
      if (r.x < b.minX - pad || r.x > b.maxX + pad || r.y < b.minY - pad || r.y > b.maxY + pad) continue;
      const p = project(r), isSelected = driver.driver_number === this.selected;
      const color = /^[a-f\d]{6}$/i.test(driver.team_colour) ? `#${driver.team_colour}` : '#aab3c5';
      c.beginPath(); c.arc(p.x, p.y, isSelected ? 8 : 5, 0, Math.PI * 2);
      c.fillStyle = color; c.fill(); c.strokeStyle = '#12151a'; c.lineWidth = 2; c.stroke();
      if (isSelected) { c.beginPath(); c.arc(p.x, p.y, 12, 0, Math.PI * 2); c.strokeStyle = '#ffffffa0'; c.lineWidth = 1; c.stroke(); }
      if (this.labels || isSelected) {
        const text = driver.name_acronym || String(driver.driver_number);
        c.font = `${isSelected ? 'bold ' : ''}9px Consolas, monospace`;
        c.strokeStyle = '#13161c'; c.lineWidth = 4; c.strokeText(text, p.x + 10, p.y - 8);
        c.fillStyle = isSelected ? '#fff' : '#b9c0cd'; c.fillText(text, p.x + 10, p.y - 8);
      }
      this.hits.push({ ...p, number: driver.driver_number }); count++;
    }
    return count;
  }
}

