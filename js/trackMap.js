// trackMap.js - Handles visual representation of cars on track

const TrackMap = {
  canvas: null,
  ctx: null,
  container: null,
  
  // Track geometry
  trackPath: [],
  minX: 0, maxX: 0,
  minY: 0, maxY: 0,
  width: 0,
  height: 0,
  padding: 40,

  init() {
    console.log("Initializing Track Map...");
    this.container = document.getElementById('track-map-container');
    this.canvas = document.getElementById('trackCanvas');
    this.ctx = this.canvas.getContext('2d');
    
    // Bind updates
    F1API.onTrackUpdate = this.updatePositions.bind(this);
    F1API.onTrackPathLoaded = this.loadTrackPath.bind(this);
    
    // Handle resize
    window.addEventListener('resize', this.resize.bind(this));
    this.resize();
    
    // Initial draw
    this.drawBackground();
  },

  resize() {
    if (!this.container) return;
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    
    // Support high DPI
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    
    this.ctx.scale(dpr, dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    
    this.drawBackground();
  },

  loadTrackPath(points) {
    this.trackPath = points;
    if (!points || points.length === 0) return;
    
    // Find bounds to scale track to fit canvas
    this.minX = Math.min(...points.map(p => p.x));
    this.maxX = Math.max(...points.map(p => p.x));
    this.minY = Math.min(...points.map(p => p.y));
    this.maxY = Math.max(...points.map(p => p.y));
    
    this.drawBackground();
  },

  mapToCanvas(x, y) {
    const rangeX = this.maxX - this.minX;
    const rangeY = this.maxY - this.minY;
    
    if (rangeX === 0 || rangeY === 0) return { x: this.width/2, y: this.height/2 };

    // Scale while preserving aspect ratio
    const scaleX = (this.width - this.padding * 2) / rangeX;
    const scaleY = (this.height - this.padding * 2) / rangeY;
    const scale = Math.min(scaleX, scaleY);
    
    // Center track in the view
    const scaledWidth = rangeX * scale;
    const scaledHeight = rangeY * scale;
    const offsetX = (this.width - scaledWidth) / 2;
    const offsetY = (this.height - scaledHeight) / 2;
    
    // Invert Y axis because canvas 0,0 is top-left, but F1 coordinates 0,0 is usually cartesian bottom-left
    const cx = (x - this.minX) * scale + offsetX;
    const cy = this.height - ((y - this.minY) * scale + offsetY);
    
    return { x: cx, y: cy };
  },

  drawBackground() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    if (this.trackPath.length === 0) {
        this.ctx.fillStyle = 'rgba(255,255,255,0.5)';
        this.ctx.font = '14px "Space Grotesk", sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText("Generating circuit layout...", this.width / 2, this.height / 2);
        return;
    }

    // Draw track circuit outline
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = 6;
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    
    this.ctx.beginPath();
    this.trackPath.forEach((p, idx) => {
        const coords = this.mapToCanvas(p.x, p.y);
        if (idx === 0) {
            this.ctx.moveTo(coords.x, coords.y);
        } else {
            this.ctx.lineTo(coords.x, coords.y);
        }
    });
    this.ctx.stroke();
  },

  updatePositions(locData, drivers) {
    this.drawBackground();
    
    if (!locData || locData.length === 0 || this.trackPath.length === 0) return;
    
    // API returns multiple location hits per driver. Only plot the single most recent one.
    const latestLoc = {};
    locData.forEach(l => {
        // Since locData is ordered by date (or we can just override to keep the last one seen)
        latestLoc[l.driver_number] = l;
    });

    Object.keys(latestLoc).forEach(dNum => {
      const l = latestLoc[dNum];
      const driver = drivers.find(d => d.driver_number == dNum) || { driver_number: dNum, team_colour: '888' };
      
      const coords = this.mapToCanvas(l.x, l.y);
      this.drawDriverDot(driver, coords.x, coords.y);
    });
  },

  drawDriverDot(driver, x, y) {
    const color = driver.team_colour ? `#${driver.team_colour}` : '#fff';
    
    // Outer glow
    this.ctx.shadowBlur = 10;
    this.ctx.shadowColor = color;
    
    // Main dot
    this.ctx.beginPath();
    this.ctx.arc(x, y, 6, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
    
    // Reset shadow
    this.ctx.shadowBlur = 0;
    
    // Driver Number Background
    this.ctx.fillStyle = 'rgba(0,0,0,0.85)';
    this.ctx.beginPath();
    this.ctx.roundRect(x - 10, y + 10, 20, 14, 4);
    this.ctx.fill();
    
    // Driver Number Text
    this.ctx.fillStyle = '#fff';
    this.ctx.font = 'bold 10px "Space Grotesk", sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(driver.driver_number, x, y + 21);
  }
};
