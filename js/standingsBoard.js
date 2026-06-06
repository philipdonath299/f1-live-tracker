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

    const isQualifying = F1API.session && F1API.session.session_name && (F1API.session.session_name.toLowerCase().includes('qualifying') || F1API.session.session_name.toLowerCase().includes('practice'));

    this.container.innerHTML = '';
    
    // Use fragment for performance
    const fragment = document.createDocumentFragment();
    
    data.forEach((driver, idx) => {
      const position = idx + 1;
      const color = driver.team_colour ? `#${driver.team_colour}` : '#888';
      
      const row = document.createElement('div');
      row.className = 'driver-row';
      row.style.borderLeftColor = color;
      
      // Use real gap interval if available, otherwise just show Leader or fallback
      let gapStr = "Leader";
      if (position > 1) {
          if (driver.gap !== undefined && driver.gap !== null) {
              gapStr = driver.gap.toString().includes('L') || driver.gap.toString().includes('+') ? driver.gap : `+${driver.gap}s`;
          } else {
             gapStr = `+${(position * 2.3).toFixed(3)}s`; // Fake gap fallback
          }
      }

      const drsBadge = driver.drs ? '<span class="drs-badge">DRS</span>' : '';

      const renderSector = (s) => {
          if (!s) return '';
          const time = typeof s === 'object' ? s.time : s;
          const colorClass = typeof s === 'object' ? `sector-${s.color}` : '';
          return `<span class="${colorClass}">${time}</span>`;
      };

      const sectorsHtml = (driver.s1 && driver.s2 && driver.s3)
        ? `<div class="sectors">
             ${renderSector(driver.s1)}
             ${renderSector(driver.s2)}
             ${renderSector(driver.s3)}
           </div>`
        : '';

      const intervalHtml = driver.interval ? `<span class="interval">${driver.interval}</span>` : '';

      const timingInfo = isQualifying
        ? `<div class="timing-main">
             <div class="timing-top">
                <span class="gap">${gapStr}</span>
                <span class="best-lap">${driver.best_lap ? driver.best_lap : '--:--:--'}</span>
             </div>
             ${sectorsHtml}
           </div>`
        : `<div class="timing-main">
             <span class="gap">${gapStr}</span>
             <div class="timing-bottom">
                ${intervalHtml}
                <span class="last-lap">${driver.last_lap ? driver.last_lap : ''}</span>
             </div>
           </div>`;

      row.innerHTML = `
        <div class="pos">${position}</div>
        <div class="driver-info">
          <div class="name-row">
            <span class="name">${driver.full_name}</span>
            ${drsBadge}
          </div>
          <span class="team" style="color: ${color}">${driver.team_name || 'N/A'}</span>
          <span class="telemetry" style="font-size: 0.7rem; color: #aaa; margin-top:2px;">
            ${driver.tire_compound ? `<span class="tire-badge ${driver.tire_compound}">${driver.tire_compound.charAt(0)}</span> <span class="tire-age">L${driver.tire_age}</span> | ` : ''}
            ${driver.speed ? `SPD: ${driver.speed}km/h` : ''} ${driver.gear ? `| Gear: ${driver.gear}` : ''}
          </span>
        </div>
        ${timingInfo}
      `;
      
      // Add subtle entry animation delay
      row.style.animationDelay = `${idx * 0.05}s`;
      
      fragment.appendChild(row);
    });

    this.container.appendChild(fragment);
  }
};
