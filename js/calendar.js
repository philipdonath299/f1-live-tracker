// calendar.js - Manages the session list and selection

const Calendar = {
  container: null,
  sessions: [],

  async init() {
    console.log("Initializing Calendar...");
    this.container = document.getElementById('calendar-list');
    
    await this.fetchSessions();
    this.render();
  },

  async fetchSessions() {
    try {
      this.container.innerHTML = `<div class="loading-state">Loading calendar...</div>`;
      
      // Get all sessions for the current year, filter to Races for main view
      const year = new Date().getFullYear();
      const response = await fetch(`${API_BASE_URL}/sessions?year=${year}`);
      const data = await response.json();
      
      // Filter out only the main races to keep list clean, sorted by date
      this.sessions = data.filter(s => s.session_name === 'Race' || s.session_name === 'Sprint').sort((a,b) => new Date(a.date_start) - new Date(b.date_start));
      
    } catch (e) {
      console.error("Failed to fetch calendar", e);
      this.container.innerHTML = `<div class="loading-state">Failed to load calendar</div>`;
    }
  },

  render() {
    if (!this.container || this.sessions.length === 0) return;

    this.container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    
    this.sessions.forEach((session, idx) => {
      const item = document.createElement('div');
      item.className = 'calendar-item';
      if (F1API.session && F1API.session.session_key === session.session_key) {
          item.classList.add('active-session');
      }
      
      const date = new Date(session.date_start);
      const formattedDate = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      
      item.innerHTML = `
        <div class="calendar-info">
          <span class="race-name">${session.country_name} ${session.session_name === 'Sprint' ? '(Sprint)' : ''}</span>
          <span class="circuit-name">${session.location || 'TBA'}</span>
        </div>
        <div class="calendar-date">${formattedDate}</div>
      `;
      
      item.style.animationDelay = `${idx * 0.05}s`;
      
      item.addEventListener('click', () => {
         this.selectSession(session);
      });
      
      fragment.appendChild(item);
    });

    this.container.appendChild(fragment);
  },
  
  selectSession(session) {
      // Visual update in list
      document.querySelectorAll('.calendar-item').forEach(el => el.classList.remove('active-session'));
      event.currentTarget.classList.add('active-session');
      
      // Switch API Focus
      F1API.switchSession(session);
      
      // Switch back to track tab automatically for better UX
      document.querySelector('[data-tab="track"]').click();
  }
};
