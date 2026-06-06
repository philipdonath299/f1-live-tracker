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

      if (response.status === 401 || response.status === 403) {
          throw new Error("API Restricted");
      }

      const data = await response.json();
      
      // Filter out only the main races to keep list clean, sorted by date
      this.sessions = Array.isArray(data) 
        ? data.filter(s => s.session_name === 'Race' || s.session_name === 'Sprint' || s.session_name.includes('Qualifying')).sort((a,b) => new Date(a.date_start) - new Date(b.date_start))
        : [];

      if (this.sessions.length === 0) throw new Error("No sessions found");
      
    } catch (e) {
      console.error("Failed to fetch calendar, using fallback", e);
      this._loadFallbackSessions();
    }
  },

  _loadFallbackSessions() {
      this.sessions = [
          { session_key: 9472, country_name: "Bahrain", location: "Sakhir", date_start: "2024-03-02T15:00:00+00:00", session_name: "Race" },
          { session_key: 9480, country_name: "Saudi Arabia", location: "Jeddah", date_start: "2024-03-09T17:00:00+00:00", session_name: "Race" },
          { session_key: 9488, country_name: "Australia", location: "Melbourne", date_start: "2024-03-24T04:00:00+00:00", session_name: "Race" },
          { session_key: 9496, country_name: "Japan", location: "Suzuka", date_start: "2024-04-07T05:00:00+00:00", session_name: "Race" },
          { session_key: 9504, country_name: "China", location: "Shanghai", date_start: "2024-04-21T07:00:00+00:00", session_name: "Race" },
          { session_key: 9512, country_name: "Miami", location: "Miami", date_start: "2024-05-05T20:00:00+00:00", session_name: "Race" },
          { session_key: 9520, country_name: "Emilia Romagna", location: "Imola", date_start: "2024-05-19T13:00:00+00:00", session_name: "Race" },
          { session_key: 9528, country_name: "Monaco", location: "Monaco", date_start: "2024-05-26T13:00:00+00:00", session_name: "Race" },
          { session_key: 9630, country_name: "Great Britain", location: "Silverstone", date_start: "2024-07-07T14:00:00+00:00", session_name: "Qualifying" },
          { session_key: 9631, country_name: "Great Britain", location: "Silverstone", date_start: "2024-07-07T14:00:00+00:00", session_name: "Race" }
      ];
      this.render();
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
          <span class="race-name">${session.country_name} ${session.session_name !== 'Race' ? `(${session.session_name})` : ''}</span>
          <span class="circuit-name">${session.location || 'TBA'}</span>
        </div>
        <div class="calendar-date">${formattedDate}</div>
      `;
      
      item.style.animationDelay = `${idx * 0.05}s`;
      
      item.addEventListener('click', (e) => {
         this.selectSession(session, e);
      });
      
      fragment.appendChild(item);
    });

    this.container.appendChild(fragment);
  },
  
  selectSession(session, e) {
      // Visual update in list
      document.querySelectorAll('.calendar-item').forEach(el => el.classList.remove('active-session'));
      if (e && e.currentTarget) e.currentTarget.classList.add('active-session');
      
      // Switch API Focus
      F1API.switchSession(session);
      
      // Switch back to track tab automatically for better UX
      document.querySelector('[data-tab="track"]').click();
  }
};
