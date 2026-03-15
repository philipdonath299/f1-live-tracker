// trackMap.js - Handles visual representation of cars on track

const TrackMap = {
  canvas: null,
  ctx: null,
  container: null,
  
  // Track specific (Hardcoded to a generic oval for demo if no real track data)
  trackPath: [],
  width: 0,
  height: 0,

  init() {
    console.log("Initializing Track Map...");
    this.container = document.getElementById('track-map-container');
    this.canvas = document.getElementById('trackCanvas');
    this.ctx = this.canvas.getContext('2d');
    
    // Bind updates
    F1API.onTrackUpdate = this.updatePositions.bind(this);
    
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

  drawBackground() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    // Draw generic racing circuit
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = 8;
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    
    const cx = this.width / 2;
    const cy = this.height / 2;
    const rx = Math.min(this.width, this.height) * 0.4;
    const ry = Math.min(this.width, this.height) * 0.25;
    
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
    this.ctx.stroke();
    
    // "Finish line"
    this.ctx.lineWidth = 4;
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    this.ctx.beginPath();
    this.ctx.moveTo(cx + rx - 10, cy);
    this.ctx.lineTo(cx + rx + 10, cy);
    this.ctx.stroke();
  },

  updatePositions(driversData) {
    this.drawBackground();
    
    if (!driversData || driversData.length === 0) return;
    
    const cx = this.width / 2;
    const cy = this.height / 2;
    const rx = Math.min(this.width, this.height) * 0.4;
    const ry = Math.min(this.width, this.height) * 0.25;

    // Simulate positions around track based on array index for demo
    driversData.forEach((driver, idx) => {
      // Offset by index to spread them out
      const progress = (idx / driversData.length) * Math.PI * 2;
      
      // Calculate x,y on ellipse
      const x = cx + rx * Math.cos(progress);
      const y = cy + ry * Math.sin(progress);
      
      this.drawDriverDot(driver, x, y);
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
    
    // Label tag
    this.ctx.fillStyle = '#fff';
    this.ctx.font = 'bold 10px "Space Grotesk", sans-serif';
    this.ctx.textAlign = 'center';
    
    // Driver Number Background
    this.ctx.fillStyle = 'rgba(0,0,0,0.7)';
    this.ctx.beginPath();
    this.ctx.roundRect(x - 10, y + 8, 20, 14, 4);
    this.ctx.fill();
    
    // Driver Number Text
    this.ctx.fillStyle = '#fff';
    this.ctx.fillText(driver.driver_number, x, y + 19);
  }
};
