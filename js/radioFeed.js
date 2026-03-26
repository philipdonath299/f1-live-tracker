// radioFeed.js - Renders radio comms timeline

const RadioFeed = {
  container: null,

  init() {
    console.log("Initializing Radio Feed...");
    this.container = document.getElementById('radio-feed');
    
    // Bind updates
    F1API.onRadioUpdate = this.render.bind(this);
  },

  render(messages) {
    if (!this.container) return;
    
    if (!messages || messages.length === 0) {
       this.container.innerHTML = `<div class="loading-state">Listening to feeds...</div>`;
       return;
    }

    this.container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    
    messages.forEach(msg => {
      const color = msg.driver && msg.driver.team_colour ? `#${msg.driver.team_colour}` : '#888';
      const driverName = msg.driver ? msg.driver.full_name : `Driver ${msg.driver_number}`;
      
      const item = document.createElement('div');
      item.className = 'radio-item';
      
      // OpenF1 returns recording_url (audio), use msg.audioUrl set during processing
      const audioHtml = msg.audioUrl
        ? `<audio controls preload="none" style="width:100%;margin-top:6px;height:32px;">
             <source src="${msg.audioUrl}" type="audio/mpeg">
           </audio>`
        : msg.message
          ? `<p style="margin:4px 0 0;font-size:0.85rem;color:#ccc;">"${msg.message}"</p>`
          : `<p style="margin:4px 0 0;font-size:0.75rem;color:#666;font-style:italic;">No audio available</p>`;
      
      item.innerHTML = `
        <div class="radio-header">
           <div class="driver">
              <span class="dot" style="background-color: ${color}"></span>
              <strong>${driverName}</strong>
           </div>
           <span class="time">${msg.time}</span>
        </div>
        <div class="radio-body">
          <i data-lucide="mic"></i>
          ${audioHtml}
        </div>
      `;
      
      fragment.appendChild(item);
    });

    this.container.appendChild(fragment);
    
    // Re-initialize any new lucide icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
};

