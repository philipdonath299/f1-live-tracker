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
      const color = msg.driver.team_colour ? `#${msg.driver.team_colour}` : '#888';
      
      const item = document.createElement('div');
      item.className = 'radio-item';
      
      item.innerHTML = `
        <div class="radio-header">
           <div class="driver">
              <span class="dot" style="background-color: ${color}"></span>
              <strong>${msg.driver.full_name}</strong>
           </div>
           <span class="time">${msg.time}</span>
        </div>
        <div class="radio-body">
          <i data-lucide="mic"></i>
          <p>"${msg.message}"</p>
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
