// f1-api.js - Handles communication with OpenF1 or fallback data

const API_BASE_URL = 'https://api.openf1.org/v1';

const F1API = {
  session: null,
  pollInterval: null,
  
  // Caches
  drivers: [],
  positions: {},
  radios: [],
  trackPoints: [], // Historical points to draw track
  
  // Callbacks for UI updates
  onStandingsUpdate: null,
  onRadioUpdate: null,
  onTrackUpdate: null,
  onTrackPathLoaded: null,

  async initialize() {
    console.log("Initializing F1 API Connection...");
    
    // 1. Get latest session
    try {
      const response = await fetch(`${API_BASE_URL}/sessions`);
      const sessions = await response.json();
      
      if (sessions && sessions.length > 0) {
        // Get most recent session (qualifying, race, practice)
        this.session = sessions[sessions.length - 1];
        document.getElementById('session-name').innerHTML = `${this.session.country_name} - ${this.session.session_name} <span class="pulse-dot" style="display:inline-block; margin-left: 4px;"></span>`;
        console.log("Session loaded:", this.session);
      } else {
         document.getElementById('session-name').textContent = `Demo Mode`;
      }
      
      // 2. Load reference driver list (even for past session to get driver info)
      await this.fetchDrivers();

      // 3. Load baseline track path (fetch 3 minutes of a single driver's location to draw the track shape)
      await this.loadTrackPath();
      
    } catch(e) {
      console.warn("OpenF1 API not reachable, falling back to demo state", e);
      document.getElementById('session-name').textContent = `Demo Mode`;
      // Load mock data if API fails to allow UI to function
      this._loadMockDrivers();
    }
  },

  async fetchDrivers() {
    if (!this.session) return;
    
    try {
      const res = await fetch(`${API_BASE_URL}/drivers?session_key=${this.session.session_key}`);
      const data = await res.json();
      // Filter out invalid driver numbers
      this.drivers = data.filter(d => d.driver_number !== null);
    } catch(e) {
      console.error("Error fetching drivers", e);
    }
  },

  async loadTrackPath() {
      if (!this.session || this.drivers.length === 0) return;
      
      try {
          // Take Max Verstappen or the first driver
          const firstDriver = this.drivers[0].driver_number;
          
          // Fetch the first 2 minutes of the session for this driver to build the track circuit lines
          const sessionStart = new Date(this.session.date_start);
          const endQuery = new Date(sessionStart.getTime() + (2 * 60000)).toISOString();
          
          const res = await fetch(`${API_BASE_URL}/location?session_key=${this.session.session_key}&driver_number=${firstDriver}&date<=${endQuery}`);
          const data = await res.json();
          this.trackPoints = data.map(d => ({ x: d.x, y: d.y }));
          
          if (this.onTrackPathLoaded && this.trackPoints.length > 0) {
              this.onTrackPathLoaded(this.trackPoints);
          }
      } catch (e) {
          console.warn("Failed to build baseline track path", e);
      }
  },

  async pollData() {
    console.log("Polling data tick...");
    
    if (this.session) {
      try {
        const now = new Date();
        const sessionStart = new Date(this.session.date_start);
        const isLive = (now - sessionStart) < (4 * 60 * 60 * 1000); // Assume live if started less than 4 hours ago
        
        if (isLive) {
            const start_time = new Date(now.getTime() - 60000).toISOString(); 
            const recent_loc = new Date(now.getTime() - 10000).toISOString(); 
            
            const posRes = await fetch(`${API_BASE_URL}/position?session_key=${this.session.session_key}&date>=${start_time}`);
            const posData = await posRes.json();
            
            const locRes = await fetch(`${API_BASE_URL}/location?session_key=${this.session.session_key}&date>=${recent_loc}`);
            const locData = await locRes.json();

            const radioRes = await fetch(`${API_BASE_URL}/team_radio?session_key=${this.session.session_key}&date>=${start_time}`);
            const radioData = await radioRes.json();

            if (posData && posData.length > 0) {
                const formatted = this._formatStandings(posData);
                if (this.onStandingsUpdate) this.onStandingsUpdate(formatted);
            }

            if (locData && locData.length > 0) {
                if (this.onTrackUpdate) this.onTrackUpdate(locData, this.drivers);
            }

            if (radioData && radioData.length > 0) {
                this._processRadios(radioData);
            }
        } else {
            console.log("Session is past, doing one-time historical fetch");
            if (this.pollInterval) clearInterval(this.pollInterval);
            
            const posRes = await fetch(`${API_BASE_URL}/position?session_key=${this.session.session_key}`);
            const posData = await posRes.json();
            
            const radioRes = await fetch(`${API_BASE_URL}/team_radio?session_key=${this.session.session_key}`);
            const radioData = await radioRes.json();
            
            if (posData && posData.length > 0) {
                const formatted = this._formatStandings(posData);
                if (this.onStandingsUpdate) this.onStandingsUpdate(formatted);
            }
            
            if (radioData && radioData.length > 0) {
                this._processRadios(radioData);
            }
            
            document.getElementById('session-name').innerHTML = `${this.session.country_name} - ${this.session.session_name} <span style="font-size:0.7rem; color: #888; margin-left: 6px;">(FINAL)</span>`;
        }
      } catch(e) {
        console.warn("Poll fetch failed", e);
      }
    } else {
      this._demoTick();
    }
  },
  
  _formatStandings(positions) {
      // API returns multiple entries per driver over time. Get latest position per driver
      const latestPos = {};
      positions.forEach(p => {
          latestPos[p.driver_number] = p;
      });
      
      const merged = Object.keys(latestPos).map(dNum => {
          const p = latestPos[dNum];
          const driver = this.drivers.find(d => d.driver_number == dNum);
          return {
              ...(driver || { full_name: `Driver ${dNum}`, team_colour: "888" }),
              position: p.position
          };
      });
      
      // Sort by position
      return merged.sort((a, b) => a.position - b.position);
  },
  
  _processRadios(radios) {
      // API radios come in an array. We add new ones to top
      let updated = false;
      const exist_dates = this.radios.map(r => r.date);
      radios.forEach(msg => {
          if (!exist_dates.includes(msg.date)) {
              msg.driver = this.drivers.find(d => d.driver_number == msg.driver_number) || { full_name: `Driver ${msg.driver_number}`, team_colour: '888' };
              msg.time = new Date(msg.date).toLocaleTimeString(); // Format time
              this.radios.unshift(msg);
              updated = true;
          }
      });
      
      if (updated && this.onRadioUpdate) {
          this.onRadioUpdate(this.radios.slice(0, 20));
      }
  },

  startPolling() {
    this.pollData();
    // Poll every 5 seconds limits API hits
    this.pollInterval = setInterval(() => this.pollData(), 5000);
  },

  async switchSession(newSession) {
      console.log("Switching to session:", newSession.meeting_name);
      
      // 1. Stop current polling
      if (this.pollInterval) {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
      }
      
      // 2. Clear Caches
      this.session = newSession;
      this.drivers = [];
      this.positions = {};
      this.radios = [];
      this.trackPoints = [];
      
      // 3. Clear UI immediately
      document.getElementById('session-name').innerHTML = `${newSession.country_name} - ${newSession.session_name} <span class="pulse-dot" style="display:inline-block; margin-left: 4px;"></span>`;
      if (this.onStandingsUpdate) this.onStandingsUpdate([]);
      if (this.onRadioUpdate) this.onRadioUpdate([]);
      if (this.onTrackPathLoaded) this.onTrackPathLoaded([]); // clear canvas
      
      // 4. Fetch new baseline info
      await this.fetchDrivers();
      await this.loadTrackPath();
      
      // 5. Restart polling for the new session
      this.startPolling();
  },
  
  // --- Demo Fallback Logic below ---
  _loadMockDrivers() {
    this.drivers = [
      { driver_number: 1, full_name: "Max Verstappen", team_name: "Red Bull Racing", team_colour: "3671C6" },
      { driver_number: 4, full_name: "Lando Norris", team_name: "McLaren", team_colour: "FF8000" },
      { driver_number: 16, full_name: "Charles Leclerc", team_name: "Ferrari", team_colour: "E80020" },
      { driver_number: 44, full_name: "Lewis Hamilton", team_name: "Mercedes", team_colour: "27F4D2" },
      { driver_number: 55, full_name: "Carlos Sainz", team_name: "Ferrari", team_colour: "E80020" },
      { driver_number: 81, full_name: "Oscar Piastri", team_name: "McLaren", team_colour: "FF8000" }
    ];
  },
  
  _demoTick() {
    const sorted = [...this.drivers].sort(() => Math.random() - 0.5);
    
    if (Math.random() > 0.8 && this.onRadioUpdate) {
      const randomDriver = this.drivers[Math.floor(Math.random() * this.drivers.length)];
      this.radios.unshift({
        driver: randomDriver,
        message: ["Push now", "Box box", "I have no grip", "Copy that", "Tyres are gone"][Math.floor(Math.random() * 5)],
        time: new Date().toLocaleTimeString()
      });
      this.onRadioUpdate(this.radios.slice(0, 20));
    }
    
    if (this.onStandingsUpdate) {
      const displayData = sorted.map((d, i) => ({...d, position: i+1}));
      this.onStandingsUpdate(displayData);
    }
    // Note: Track Update demo was removed to focus on real OpenF1 plotting
  }
};
