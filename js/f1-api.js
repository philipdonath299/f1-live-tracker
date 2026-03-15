// f1-api.js - Handles communication with OpenF1 or fallback data

const API_BASE_URL = 'https://api.openf1.org/v1';

const F1API = {
  session: null,
  pollInterval: null,
  
  // Caches
  drivers: [],
  positions: {},
  radios: [],
  
  // Callbacks for UI updates
  onStandingsUpdate: null,
  onRadioUpdate: null,
  onTrackUpdate: null,

  async initialize() {
    console.log("Initializing F1 API Connection...");
    
    // 1. Get latest session
    try {
      const response = await fetch(`${API_BASE_URL}/sessions?session_name=Race&year=2024`);
      const sessions = await response.json();
      
      if (sessions && sessions.length > 0) {
        // Get most recent race
        this.session = sessions[sessions.length - 1];
        document.getElementById('session-name').textContent = `${this.session.meeting_name} - ${this.session.session_name}`;
        console.log("Session loaded:", this.session);
      } else {
         document.getElementById('session-name').textContent = `Demo Mode`;
      }
      
      // 2. Load reference driver list (even for past session to get driver info)
      await this.fetchDrivers();
      
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
      this.drivers = data;
    } catch(e) {
      console.error("Error fetching drivers", e);
    }
  },

  async pollData() {
    // In a real app we'd use WebSocket for live sessions here.
    // For OpenF1 (REST), we poll if session is active, or just fetch once if past.
    console.log("Polling data tick...");
    
    if (this.session) {
      // Simplified polling logic 
      try {
        // Fetch positions
        const start_time = new Date(Date.now() - 30000).toISOString(); // Last 30s
        const posRes = await fetch(`${API_BASE_URL}/position?session_key=${this.session.session_key}&date>=${start_time}`);
        const posData = await posRes.json();
        
        if (posData && posData.length > 0) {
           this.positions = posData;
           if (this.onStandingsUpdate) this.onStandingsUpdate(this.positions);
        }
      } catch(e) {
        // Ignore poll errors quietly
      }
    } else {
      // Demo logic
      this._demoTick();
    }
  },

  startPolling() {
    // First immediate tick
    this.pollData();
    // Then set interval
    this.pollInterval = setInterval(() => this.pollData(), 3000);
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
    // Simulate standings update
    const sorted = [...this.drivers].sort(() => Math.random() - 0.5); // Randomize
    
    // Simulate Radio
    if (Math.random() > 0.8 && this.onRadioUpdate) {
      const randomDriver = this.drivers[Math.floor(Math.random() * this.drivers.length)];
      this.radios.unshift({
        driver: randomDriver,
        message: ["Push now", "Box box", "I have no grip", "Copy that", "Tyres are gone"][Math.floor(Math.random() * 5)],
        time: new Date().toLocaleTimeString()
      });
      this.onRadioUpdate(this.radios);
    }
    
    if (this.onStandingsUpdate) this.onStandingsUpdate(sorted);
    if (this.onTrackUpdate) this.onTrackUpdate(this.drivers);
  }
};
