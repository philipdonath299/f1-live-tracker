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
  apiRestricted: false,
  
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

      if (response.status === 401 || response.status === 403) {
        this.apiRestricted = true;
        throw new Error("API Restricted (Live Session)");
      }

      const sessions = await response.json();
      
      if (sessions && sessions.length > 0) {
        this.session = sessions[0];
        document.getElementById('session-name').innerHTML =
          `${this.session.country_name} - ${this.session.session_name} <span class="pulse-dot" style="display:inline-block; margin-left: 4px;"></span>`;
        console.log("Session loaded:", this.session);
      } else {
        document.getElementById('session-name').textContent = 'Demo Mode';
        this._loadMockDrivers();
      }
      
      // 2. Fetch drivers (must complete before polling, but is fast)
      await this.fetchDrivers();

      // 3. Load track path IN THE BACKGROUND - do NOT await this.
      // This lets startPolling() fire immediately so standings appear right away.
      this.loadTrackPath();
      
    } catch(e) {
      console.warn("OpenF1 API not reachable, falling back to demo state", e);
      document.getElementById('session-name').textContent = 'Demo Mode';
      this.session = null; // Ensure we are in demo mode
      this._loadMockDrivers();
      this.loadTrackPath();
    }
  },

  async fetchDrivers() {
    if (!this.session) {
        this._loadMockDrivers();
        return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/drivers?session_key=${this.session.session_key}`);
      if (res.status === 401 || res.status === 403) {
          throw new Error("API Restricted");
      }
      const data = await res.json();
      this.drivers = Array.isArray(data) ? data.filter(d => d.driver_number !== null) : [];
      console.log(`Loaded ${this.drivers.length} drivers`);
    } catch(e) {
      console.error("Error fetching drivers", e);
      this.session = null;
      this._loadMockDrivers();
    }
  },

  async loadTrackPath() {
    if (!this.session || this.drivers.length === 0) {
        this._generateMockTrackPath();
        return;
    }
    
    try {
      // Fetch baseline track path using location history.

      // Prefer driver #1 or fall back to first in list
      const preferred = this.drivers.find(d => d.driver_number === 1) || this.drivers[0];
      const driverNum = preferred.driver_number;

      // 1. Find EXACTLY when this driver was actually on track by checking their first position record
      let actualStartTimeMs = new Date(this.session.date_start).getTime();
      
      const posRes = await fetch(`${API_BASE_URL}/position?session_key=${this.session.session_key}&driver_number=${driverNum}`);
      if (posRes.status === 401 || posRes.status === 403) throw new Error("API Restricted");
      const posData = await posRes.json();
      
      if (Array.isArray(posData) && posData.length > 0) {
        // Use the first recorded position minus 2 minutes to ensure we capture a full driving lap
        actualStartTimeMs = new Date(posData[0].date).getTime() - (2 * 60 * 1000);
      } else {
        // Fallback: Just look 60 minutes after the official start (usually when races actually begin after buildup)
        actualStartTimeMs += 60 * 60 * 1000;
      }

      const windowStart = new Date(actualStartTimeMs).toISOString();
      const windowEnd = new Date(actualStartTimeMs + 6 * 60 * 1000).toISOString(); // 6-minute trace

      const res = await fetch(
        `${API_BASE_URL}/location?session_key=${this.session.session_key}&driver_number=${driverNum}&date>=${windowStart}&date<=${windowEnd}`
      );
      if (res.status === 401 || res.status === 403) throw new Error("API Restricted");
      const data = await res.json();
      this.trackPoints = Array.isArray(data) ? data.map(d => ({ x: d.x, y: d.y })) : [];
      
      if (this.onTrackPathLoaded && this.trackPoints.length > 0) {
        console.log(`Track path loaded: ${this.trackPoints.length} points`);
        this.onTrackPathLoaded(this.trackPoints);
      } else {
        // Ultimate fallback if still no points, just fetch everything and limit purely to first 3000 points
        console.warn("Track points still empty with dynamic date window. Trying without date limits.");
        const res3 = await fetch(`${API_BASE_URL}/location?session_key=${this.session.session_key}&driver_number=${driverNum}`);
        if (res3.status === 401 || res3.status === 403) throw new Error("API Restricted");
        const data3 = await res3.json();
        const safeData = Array.isArray(data3) ? data3 : [];
        this.trackPoints = safeData.slice(0, 3000).map(d => ({ x: d.x, y: d.y }));
        if (this.onTrackPathLoaded && this.trackPoints.length > 0) {
           this.onTrackPathLoaded(this.trackPoints);
        } else {
            this._generateMockTrackPath();
        }
      }
    } catch (e) {
      console.warn("Failed to build baseline track path, using mock", e);
      this._generateMockTrackPath();
    }
  },

  async pollData() {
    console.log("Polling data tick...");
    
    if (!this.session || this.apiRestricted) {
      this._demoTick();
      if (!this.session) return;
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
        
        const safeFetchList = async (urls) => {
          return Promise.all(urls.map(async url => {
            try {
              const res = await fetch(url);
              if (!res.ok) {
                if (res.status === 401 || res.status === 403) this.apiRestricted = true;
                return [];
              }
              return await res.json();
            } catch (e) {
              return [];
            }
          }));
        };

        const [posData, locData, telData, radioData, weatherData, intData, rcData, stintData] = await safeFetchList([
          `${API_BASE_URL}/position?session_key=${this.session.session_key}&date>=${start_time}`,
          `${API_BASE_URL}/location?session_key=${this.session.session_key}&date>=${recent_loc}`,
          `${API_BASE_URL}/car_data?session_key=${this.session.session_key}&date>=${recent_loc}`,
          `${API_BASE_URL}/team_radio?session_key=${this.session.session_key}&date>=${start_time}`,
          `${API_BASE_URL}/weather?session_key=${this.session.session_key}&date>=${start_time}`,
          `${API_BASE_URL}/intervals?session_key=${this.session.session_key}&date>=${start_time}`,
          `${API_BASE_URL}/race_control?session_key=${this.session.session_key}&date>=${start_time}`,
          `${API_BASE_URL}/stints?session_key=${this.session.session_key}`
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
        
        // All historical fetches run concurrently. 
        // We fetch the full race data since these endpoints (unlike location/car_data) are only ~60KB.
        const safeFetchList = async (urls) => {
          return Promise.all(urls.map(async url => {
            try {
              const res = await fetch(url);
              if (!res.ok) return [];
              return await res.json();
            } catch (e) {
              return [];
            }
          }));
        };

        const [posData, radioData, weatherData, intData, rcData, stintData] = await safeFetchList([
          `${API_BASE_URL}/position?session_key=${this.session.session_key}`,
          `${API_BASE_URL}/team_radio?session_key=${this.session.session_key}`,
          `${API_BASE_URL}/weather?session_key=${this.session.session_key}`,
          `${API_BASE_URL}/intervals?session_key=${this.session.session_key}`,
          `${API_BASE_URL}/race_control?session_key=${this.session.session_key}`,
          `${API_BASE_URL}/stints?session_key=${this.session.session_key}`
        ]);
        
        if (Array.isArray(posData) && posData.length > 0) {
          const formatted = this._formatStandings(posData, [], intData, stintData);
          if (this.onStandingsUpdate) this.onStandingsUpdate(formatted);
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
        drs:           t.drs === 10 || t.drs === 12 || t.drs === 14, // DRS Open codes
        gap:           i.gap_to_leader || null,
        tire_compound: s.compound || null,
        tire_age:      tireAge,
        last_lap:      p.last_lap_time || null,
        best_lap:      p.best_lap_time || null,
        s1:            p.s1 || null,
        s2:            p.s2 || null,
        s3:            p.s3 || null
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
      { driver_number: 11, full_name: "Sergio Perez",    team_name: "Red Bull Racing", team_colour: "3671C6" },
      { driver_number: 44, full_name: "Lewis Hamilton",  team_name: "Mercedes",         team_colour: "27F4D2" },
      { driver_number: 63, full_name: "George Russell",  team_name: "Mercedes",         team_colour: "27F4D2" },
      { driver_number: 16, full_name: "Charles Leclerc", team_name: "Ferrari",          team_colour: "E80020" },
      { driver_number: 55, full_name: "Carlos Sainz",    team_name: "Ferrari",          team_colour: "E80020" },
      { driver_number: 4,  full_name: "Lando Norris",    team_name: "McLaren",          team_colour: "FF8000" },
      { driver_number: 81, full_name: "Oscar Piastri",   team_name: "McLaren",          team_colour: "FF8000" },
      { driver_number: 14, full_name: "Fernando Alonso", team_name: "Aston Martin",     team_colour: "229971" },
      { driver_number: 18, full_name: "Lance Stroll",    team_name: "Aston Martin",     team_colour: "229971" },
      { driver_number: 10, full_name: "Pierre Gasly",    team_name: "Alpine",           team_colour: "0093CC" },
      { driver_number: 31, full_name: "Esteban Ocon",    team_name: "Alpine",           team_colour: "0093CC" },
      { driver_number: 23, full_name: "Alexander Albon", team_name: "Williams",         team_colour: "64C4FF" },
      { driver_number: 2,  full_name: "Logan Sargeant",  team_name: "Williams",         team_colour: "64C4FF" },
      { driver_number: 3,  full_name: "Daniel Ricciardo", team_name: "RB",               team_colour: "6692FF" },
      { driver_number: 22, full_name: "Yuki Tsunoda",    team_name: "RB",               team_colour: "6692FF" },
      { driver_number: 77, full_name: "Valtteri Bottas", team_name: "Kick Sauber",      team_colour: "52E252" },
      { driver_number: 24, full_name: "Zhou Guanyu",     team_name: "Kick Sauber",      team_colour: "52E252" },
      { driver_number: 27, full_name: "Nico Hulkenberg", team_name: "Haas",              team_colour: "B6BABD" },
      { driver_number: 20, full_name: "Kevin Magnussen", team_name: "Haas",              team_colour: "B6BABD" }
    ];
  },

  _generateMockTrackPath() {
    console.log("Generating Mock Track Path...");
    // Generate a simple oval/squircle for the demo
    const points = [];
    const steps = 100;
    const rx = 4000;
    const ry = 2500;
    for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        // Add some noise to make it look like a real track
        const noiseX = Math.sin(angle * 3) * 200;
        const noiseY = Math.cos(angle * 5) * 150;
        points.push({
            x: Math.cos(angle) * rx + noiseX,
            y: Math.sin(angle) * ry + noiseY
        });
    }
    this.trackPoints = points;
    if (this.onTrackPathLoaded) {
        this.onTrackPathLoaded(this.trackPoints);
    }
  },
  
  _demoTick() {
    const sessionToUse = this.session || { session_name: 'Race' };
    const isQualy = sessionToUse.session_name.toLowerCase().includes('qualifying') || sessionToUse.session_name.toLowerCase().includes('practice');

    // Persistent state for demo
    if (!this._demoState) {
        this._demoState = {
            laps: 0,
            drivers: this.drivers.map(d => ({
                ...d,
                progress: Math.random(), // 0 to 1 along the track
                last_lap: 0,
                best_lap: 85 + Math.random() * 5,
                tire_compound: ["SOFT", "MEDIUM", "HARD"][Math.floor(Math.random() * 3)],
                tire_age: Math.floor(Math.random() * 10),
                status: 'ON TRACK'
            }))
        };
    }

    this._demoState.laps += 0.01; // Slow lap progression

    this._demoState.drivers.forEach(d => {
        // Vary status for qualy
        if (isQualy && Math.random() > 0.98) {
            d.status = d.status === 'IN PITS' ? 'ON TRACK' : 'IN PITS';
        }

        if (d.status === 'ON TRACK') {
            d.progress += 0.005 + Math.random() * 0.002;
            if (d.progress >= 1) {
                d.progress -= 1;
                d.last_lap = 85 + Math.random() * 10;
                if (d.last_lap < d.best_lap) d.best_lap = d.last_lap;
                d.tire_age++;
            }
            d.speed = Math.floor(200 + Math.random() * 120);
            d.gear = Math.floor(1 + Math.random() * 8);
            d.drs = Math.random() > 0.7;
        } else {
            d.speed = 0;
            d.gear = 0;
            d.drs = false;
        }
    });

    const sorted = [...this._demoState.drivers].sort((a, b) => {
        if (isQualy) {
            const aLap = a.best_lap || 999;
            const bLap = b.best_lap || 999;
            return aLap - bLap;
        }
        return b.progress - a.progress;
    });

    if (Math.random() > 0.9 && this.onRadioUpdate) {
      const randomDriver = this.drivers[Math.floor(Math.random() * this.drivers.length)];
      this.radios.unshift({
        driver: randomDriver,
        message: ["Push now", "Box box", "I have no grip", "Copy that", "Tyres are gone", "Yellow flag in sector 2", "Blue flags!", "No power!"][Math.floor(Math.random() * 8)],
        time: new Date().toLocaleTimeString()
      });
      this.onRadioUpdate(this.radios.slice(0, 20));
    }

    if (this.onStandingsUpdate) {
      this.onStandingsUpdate(sorted.map((d, i) => {
          const formatTime = (seconds) => {
              const m = Math.floor(seconds / 60);
              const s = (seconds % 60).toFixed(3);
              return `${m}:${s.padStart(6, '0')}`;
          };

          const randomColor = () => {
              const r = Math.random();
              if (r > 0.9) return 'purple';
              if (r > 0.6) return 'green';
              return 'yellow';
          };

          let interval = null;
          if (i > 0) {
              if (isQualy) {
                  interval = (d.best_lap - sorted[i-1].best_lap).toFixed(3);
              } else {
                  interval = (Math.random() * 0.5 + 0.1).toFixed(3);
              }
          }

          return {
            ...d,
            position: i + 1,
            gap: i === 0 ? "Leader" : (isQualy ? `+${(d.best_lap - sorted[0].best_lap).toFixed(3)}s` : `+${(i * 1.2 + Math.random()).toFixed(3)}s`),
            interval: interval ? `+${interval}s` : null,
            best_lap: isQualy ? formatTime(d.best_lap) : null,
            last_lap: !isQualy ? formatTime(d.last_lap || (85 + Math.random() * 10)) : null,
            s1: { time: (28 + Math.random() * 2).toFixed(3), color: randomColor() },
            s2: { time: (32 + Math.random() * 2).toFixed(3), color: randomColor() },
            s3: { time: (25 + Math.random() * 2).toFixed(3), color: randomColor() }
          };
      }));
    }

    if (this.onTrackUpdate && this.trackPoints.length > 0) {
        const locations = sorted.map(d => {
            const index = Math.floor(d.progress * (this.trackPoints.length - 1));
            const p = this.trackPoints[index];
            return {
                driver_number: d.driver_number,
                x: p.x,
                y: p.y,
                speed: d.speed,
                gear: d.gear,
                drs: d.drs
            };
        });
        this.onTrackUpdate(locations, this.drivers);
    }

    // Simulate Weather
    if (this.onWeatherUpdate && Math.random() > 0.95) {
        this.onWeatherUpdate({
            air_temperature: (25 + Math.random()).toFixed(1),
            track_temperature: (38 + Math.random() * 5).toFixed(1),
            humidity: (40 + Math.random() * 10).toFixed(0)
        });
    }
  }
};
