// standingsBoard.js - Renders leaderboard

const StandingsBoard = {
  container: null,

  init() {
    console.log("Initializing Standings...");
    this.container = document.getElementById('standings-list');
    
    // Bind updates
    F1API.onStandingsUpdate = this.render.bind(this);
  },

  render(data) {
    if (!this.container) return;
    
    if (!data || data.length === 0) {
      this.container.innerHTML = `<div class="loading-state">Waiting for timing data...</div>`;
      return;
    }

    this.container.innerHTML = '';
    
    // Use fragment for performance
    const fragment = document.createDocumentFragment();
    
    data.forEach((driver, idx) => {
      const position = idx + 1;
      const color = driver.team_colour ? `#${driver.team_colour}` : '#888';
      
      const row = document.createElement('div');
      row.className = 'driver-row';
      row.style.borderLeftColor = color;
      
      // Calculate simulated gap for demo if not provided
      let gapStr = "Leader";
      if (position > 1) {
        gapStr = `+${(position * 2.3).toFixed(3)}`; // Fake gap
      }

      row.innerHTML = `
        <div class="pos">${position}</div>
        <div class="driver-info">
          <span class="name">${driver.full_name}</span>
          <span class="team" style="color: ${color}">${driver.team_name || 'N/A'}</span>
          <span class="telemetry" style="font-size: 0.7rem; color: #aaa; margin-top:2px;">
            ${driver.speed ? `SPD: ${driver.speed}km/h` : ''} ${driver.gear ? `| Gear: ${driver.gear}` : ''}
          </span>
        </div>
        <div class="gap">${gapStr}</div>
      `;
      
      // Add subtle entry animation delay
      row.style.animationDelay = `${idx * 0.05}s`;
      
      fragment.appendChild(row);
    });

    this.container.appendChild(fragment);
  }
};
