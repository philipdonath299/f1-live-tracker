// f1-api.js - Handles communication with OpenF1 or fallback data

const API_BASE_URL = 'https://api.openf1.org/v1';

const F1API = {
  session: null,
  pollInterval: null,
  
  // Caches
  drivers: [],
  positions: {},
  radios: [],
  trackPoints: [],
  
  // Callbacks for UI updates
  onStandingsUpdate: null,
  onRadioUpdate: null,
  onTrackUpdate: null,
  onTrackPathLoaded: null,
  onWeatherUpdate: null,
  onRaceControlUpdate: null,

  async initialize() {
    console.log("Initializing F1 API Connection...");
    
    try {
      // 1. Get latest session (session_key=latest always returns the most recent one)
      const response = await fetch(`${API_BASE_URL}/sessions?session_key=latest`);
      const sessions = await response.json();
      
      if (sessions && sessions.length > 0) {
        this.session = sessions[0];
        document.getElementById('session-name').innerHTML =
          `${this.session.country_name} - ${this.session.session_name} <span class="pulse-dot" style="display:inline-block; margin-left: 4px;"></span>`;
        console.log("Session loaded:", this.session);
      } else {
        document.getElementById('session-name').textContent = 'Demo Mode';
      }
      
      // 2. Fetch drivers (must complete before polling, but is fast)
      await this.fetchDrivers();

      // 3. Load track path IN THE BACKGROUND - do NOT await this.
      // This lets startPolling() fire immediately so standings appear right away.
      this.loadTrackPath();
      
    } catch(e) {
      console.warn("OpenF1 API not reachable, falling back to demo state", e);
      document.getElementById('session-name').textContent = 'Demo Mode';
      this._loadMockDrivers();
    }
  },

  async fetchDrivers() {
    if (!this.session) return;
    try {
      const res = await fetch(`${API_BASE_URL}/drivers?session_key=${this.session.session_key}`);
      const data = await res.json();
      this.drivers = Array.isArray(data) ? data.filter(d => d.driver_number !== null) : [];
      console.log(`Loaded ${this.drivers.length} drivers`);
    } catch(e) {
      console.error("Error fetching drivers", e);
    }
  },

  async loadTrackPath() {
    if (!this.session || this.drivers.length === 0) return;
    
    try {
      // Use a 6-minute window starting from session start to trace the circuit layout.
      // This avoids downloading 34k+ rows (the entire session) while covering ~1 lap.
      const sessionStart = new Date(this.session.date_start);
      const windowEnd = new Date(sessionStart.getTime() + 6 * 60 * 1000).toISOString();
      const windowStart = sessionStart.toISOString();

      // Prefer driver #1 or fall back to first in list
      const preferred = this.drivers.find(d => d.driver_number === 1) || this.drivers[0];
      const driverNum = preferred.driver_number;

      const res = await fetch(
        `${API_BASE_URL}/location?session_key=${this.session.session_key}&driver_number=${driverNum}&date>=${windowStart}&date<=${windowEnd}`
      );
      const data = await res.json();
      this.trackPoints = Array.isArray(data) ? data.map(d => ({ x: d.x, y: d.y })) : [];
      
      if (this.onTrackPathLoaded && this.trackPoints.length > 0) {
        console.log(`Track path loaded: ${this.trackPoints.length} points`);
        this.onTrackPathLoaded(this.trackPoints);
      } else {
        console.warn("Track path returned 0 points for 6-min window, trying 20 min...");
        // Fallback: try a longer 20-minute window (some sessions have formation laps)
        const fallbackEnd = new Date(sessionStart.getTime() + 20 * 60 * 1000).toISOString();
        const res2 = await fetch(
          `${API_BASE_URL}/location?session_key=${this.session.session_key}&driver_number=${driverNum}&date>=${windowStart}&date<=${fallbackEnd}`
        );
        const data2 = await res2.json();
        this.trackPoints = Array.isArray(data2) ? data2.map(d => ({ x: d.x, y: d.y })) : [];
        if (this.onTrackPathLoaded && this.trackPoints.length > 0) {
          console.log(`Track path loaded (fallback): ${this.trackPoints.length} points`);
          this.onTrackPathLoaded(this.trackPoints);
        } else {
          console.warn("Track path still empty after fallback");
        }
      }
    } catch (e) {
      console.warn("Failed to build baseline track path", e);
    }
  },

  async pollData() {
    console.log("Polling data tick...");
    
    if (!this.session) {
      this._demoTick();
      return;
    }

    try {
      const now = new Date();
      // A session is "live" only if it ended less than 30 minutes ago
      const sessionEnd = new Date(this.session.date_end);
      const isLive = (now - sessionEnd) < (30 * 60 * 1000);
      
      if (isLive) {
        console.log("Session is LIVE, fetching recent data...");
        const start_time = new Date(now.getTime() - 60000).toISOString(); 
        const recent_loc  = new Date(now.getTime() - 10000).toISOString(); 
        
        // All live fetches run concurrently
        const [posRes, locRes, telRes, radioRes, weatherRes, intRes, rcRes, stintRes] = await Promise.all([
          fetch(`${API_BASE_URL}/position?session_key=${this.session.session_key}&date>=${start_time}`),
          fetch(`${API_BASE_URL}/location?session_key=${this.session.session_key}&date>=${recent_loc}`),
          fetch(`${API_BASE_URL}/car_data?session_key=${this.session.session_key}&date>=${recent_loc}`),
          fetch(`${API_BASE_URL}/team_radio?session_key=${this.session.session_key}&date>=${start_time}`),
          fetch(`${API_BASE_URL}/weather?session_key=${this.session.session_key}&date>=${start_time}`),
          fetch(`${API_BASE_URL}/intervals?session_key=${this.session.session_key}&date>=${start_time}`),
          fetch(`${API_BASE_URL}/race_control?session_key=${this.session.session_key}&date>=${start_time}`),
          fetch(`${API_BASE_URL}/stints?session_key=${this.session.session_key}`)
        ]);

        const [posData, locData, telData, radioData, weatherData, intData, rcData, stintData] = await Promise.all([
          posRes.json(), locRes.json(), telRes.json(), radioRes.json(),
          weatherRes.json(), intRes.json(), rcRes.json(), stintRes.json()
        ]);

        if (posData && posData.length > 0) {
          const formatted = this._formatStandings(posData, telData, intData, stintData);
          if (this.onStandingsUpdate) this.onStandingsUpdate(formatted);
        }
        if (locData && locData.length > 0) {
          const enhancedLoc = this._mergeTelemetry(locData, telData);
          if (this.onTrackUpdate) this.onTrackUpdate(enhancedLoc, this.drivers);
        }
        if (radioData && radioData.length > 0) this._processRadios(radioData);
        if (weatherData && weatherData.length > 0) {
          if (this.onWeatherUpdate) this.onWeatherUpdate(weatherData[weatherData.length - 1]);
        }
        if (Array.isArray(rcData) && rcData.length > 0) {
          if (this.onRaceControlUpdate) this.onRaceControlUpdate(rcData[rcData.length - 1]);
        }

      } else {
        // Past session - fetch final few minutes to get the ending standings
        console.log("Session is past, fetching historical data...");
        if (this.pollInterval) {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
        }

        document.getElementById('session-name').innerHTML =
          `${this.session.country_name} - ${this.session.session_name} <span style="font-size:0.7rem; color: #888; margin-left: 6px;">(FINAL)</span>`;
        
        // Use the session end time minus 3 minutes to only get the final lap/standings
        const sessionEndMs = new Date(this.session.date_end).getTime();
        const pastStart = new Date(sessionEndMs - 3 * 60 * 1000).toISOString();
        
        // All historical fetches run concurrently, filtered by date to prevent massive payload
        const [posRes, radioRes, weatherRes, intRes, rcRes, stintRes] = await Promise.all([
          fetch(`${API_BASE_URL}/position?session_key=${this.session.session_key}&date>=${pastStart}`),
          fetch(`${API_BASE_URL}/team_radio?session_key=${this.session.session_key}&date>=${pastStart}`),
          fetch(`${API_BASE_URL}/weather?session_key=${this.session.session_key}&date>=${pastStart}`),
          fetch(`${API_BASE_URL}/intervals?session_key=${this.session.session_key}&date>=${pastStart}`),
          fetch(`${API_BASE_URL}/race_control?session_key=${this.session.session_key}&date>=${pastStart}`),
          fetch(`${API_BASE_URL}/stints?session_key=${this.session.session_key}`)
        ]);

        const [posData, radioData, weatherData, intData, rcData, stintData] = await Promise.all([
          posRes.json(), radioRes.json(), weatherRes.json(),
          intRes.json(), rcRes.json(), stintRes.json()
        ]);
        
        if (posData && posData.length > 0) {
          const formatted = this._formatStandings(posData, [], intData, stintData);
          if (this.onStandingsUpdate) this.onStandingsUpdate(formatted);
        } else {
          // Fallback if the last 3 minutes had no position data (e.g. race ended under safety car early)
          const fallbackRes = await fetch(`${API_BASE_URL}/position?session_key=${this.session.session_key}&date>=${new Date(sessionEndMs - 15 * 60 * 1000).toISOString()}`);
          const fallbackPos = await fallbackRes.json();
          if (fallbackPos && fallbackPos.length > 0) {
             const formatted = this._formatStandings(fallbackPos, [], intData, stintData);
             if (this.onStandingsUpdate) this.onStandingsUpdate(formatted);
          }
        }
        
        if (radioData && radioData.length > 0) this._processRadios(radioData);
        if (weatherData && weatherData.length > 0) {
          if (this.onWeatherUpdate) this.onWeatherUpdate(weatherData[weatherData.length - 1]);
        }
        if (Array.isArray(rcData) && rcData.length > 0 && this.onRaceControlUpdate) {
          const flagMsgs = rcData.filter(m => m.flag !== null);
          if (flagMsgs.length > 0) this.onRaceControlUpdate(flagMsgs[flagMsgs.length - 1]);
        }
      }
    } catch(e) {
      console.warn("Poll fetch failed:", e);
    }
  },
  
  _formatStandings(positions, telemetryData, intData, stintData) {
    const latestPos = {};
    if (Array.isArray(positions)) positions.forEach(p => { latestPos[p.driver_number] = p; });
    
    const latestTel = {};
    if (Array.isArray(telemetryData)) telemetryData.forEach(t => { latestTel[t.driver_number] = t; });
    
    const latestInt = {};
    if (Array.isArray(intData)) intData.forEach(i => { latestInt[i.driver_number] = i; });
    
    const latestStints = {};
    if (Array.isArray(stintData)) {
      stintData.forEach(s => {
        if (!latestStints[s.driver_number] || s.stint_number > latestStints[s.driver_number].stint_number) {
          latestStints[s.driver_number] = s;
        }
      });
    }

    // Estimate current lap from the highest lap_number seen in positions
    let currentLap = 0;
    if (Array.isArray(positions)) positions.forEach(p => { if (p.lap_number && p.lap_number > currentLap) currentLap = p.lap_number; });
    
    const merged = Object.keys(latestPos).map(dNum => {
      const p = latestPos[dNum];
      const t = latestTel[dNum] || {};
      const i = latestInt[dNum] || {};
      const s = latestStints[dNum] || {};
      const driver = this.drivers.find(d => d.driver_number == dNum);

      // Tire age = current lap minus the lap the stint started (lap_start is 1-indexed)
      let tireAge = null;
      if (s.lap_start != null) {
        const refLap = currentLap > 0 ? currentLap : (p.lap_number || 0);
        tireAge = Math.max(0, refLap - s.lap_start + 1);
      }

      return {
        ...(driver || { full_name: `Driver ${dNum}`, team_colour: "888" }),
        position:      p.position,
        speed:         t.speed    || 0,
        gear:          t.n_gear   || 0,
        gap:           i.gap_to_leader || null,
        tire_compound: s.compound || null,
        tire_age:      tireAge
      };
    });
    
    return merged.sort((a, b) => a.position - b.position);
  },
  
  _mergeTelemetry(locations, telemetry) {
    const latestTel = {};
    if (Array.isArray(telemetry)) telemetry.forEach(t => { latestTel[t.driver_number] = t; });
    if (!Array.isArray(locations)) return [];
    return locations.map(loc => {
      const t = latestTel[loc.driver_number] || {};
      return { ...loc, speed: t.speed || 0, gear: t.n_gear || 0, rpm: t.rpm || 0 };
    });
  },
  
  _processRadios(radios) {
    if (!Array.isArray(radios)) return;
    let updated = false;
    const existDates = this.radios.map(r => r.date);
    radios.forEach(msg => {
      if (!existDates.includes(msg.date)) {
        msg.driver = this.drivers.find(d => d.driver_number == msg.driver_number)
          || { full_name: `Driver ${msg.driver_number}`, team_colour: '888' };
        msg.time = new Date(msg.date).toLocaleTimeString();
        // OpenF1 returns recording_url (audio file), not a text message
        msg.audioUrl = msg.recording_url || null;
        msg.message = msg.message || null; // may be null for audio-only entries
        this.radios.unshift(msg);
        updated = true;
      }
    });
    if (updated && this.onRadioUpdate) this.onRadioUpdate(this.radios.slice(0, 20));
  },

  startPolling() {
    this.pollData();
    this.pollInterval = setInterval(() => this.pollData(), 5000);
  },

  async switchSession(newSession) {
    console.log("Switching to session:", newSession.country_name, newSession.session_name);
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    this.session = newSession;
    this.drivers = [];
    this.positions = {};
    this.radios = [];
    this.trackPoints = [];
    
    document.getElementById('session-name').innerHTML =
      `${newSession.country_name} - ${newSession.session_name} <span class="pulse-dot" style="display:inline-block; margin-left: 4px;"></span>`;
    if (this.onStandingsUpdate) this.onStandingsUpdate([]);
    if (this.onRadioUpdate)     this.onRadioUpdate([]);
    if (this.onTrackPathLoaded) this.onTrackPathLoaded([]);
    if (this.onWeatherUpdate)   this.onWeatherUpdate(null);
    if (this.onRaceControlUpdate) this.onRaceControlUpdate(null);
    
    await this.fetchDrivers();
    this.loadTrackPath(); // non-blocking background load
    this.startPolling();
  },
  
  // --- Demo Fallback ---
  _loadMockDrivers() {
    this.drivers = [
      { driver_number: 1,  full_name: "Max Verstappen",  team_name: "Red Bull Racing", team_colour: "3671C6" },
      { driver_number: 4,  full_name: "Lando Norris",    team_name: "McLaren",          team_colour: "FF8000" },
      { driver_number: 16, full_name: "Charles Leclerc", team_name: "Ferrari",          team_colour: "E80020" },
      { driver_number: 44, full_name: "Lewis Hamilton",  team_name: "Mercedes",         team_colour: "27F4D2" },
      { driver_number: 55, full_name: "Carlos Sainz",    team_name: "Ferrari",          team_colour: "E80020" },
      { driver_number: 81, full_name: "Oscar Piastri",   team_name: "McLaren",          team_colour: "FF8000" }
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
      this.onStandingsUpdate(sorted.map((d, i) => ({ ...d, position: i + 1 })));
    }
  }
};
