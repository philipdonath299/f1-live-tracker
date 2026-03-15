// DOM Elements Reference
const DOM = {
  tabs: document.querySelectorAll('.tab-btn'),
  contents: document.querySelectorAll('.tab-content'),
  sessionName: document.getElementById('session-name'),
};

// Global App State
const AppState = {
  currentSession: null,
  drivers: {},
  isTracking: false,
};

// --- Tab Navigation Logic ---
function initTabs() {
  DOM.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all
      DOM.tabs.forEach(t => t.classList.remove('active'));
      DOM.contents.forEach(c => c.classList.remove('active'));

      // Add active to clicked
      tab.classList.add('active');
      const targetId = `${tab.dataset.tab}-tab`;
      document.getElementById(targetId).classList.add('active');
    });
  });
}

// --- App Initialization ---
async function initApp() {
  initTabs();
  
  // Try to connect to F1 API
  try {
    DOM.sessionName.textContent = 'Connecting API...';
    await F1API.initialize();
    
    // Once API is setup, initialize components
    TrackMap.init();
    StandingsBoard.init();
    RadioFeed.init();
    Calendar.init();
    
    // Start data loops
    F1API.startPolling();
    
  } catch (error) {
    console.error("Failed to initialize app:", error);
    DOM.sessionName.textContent = 'API Offline';
    DOM.sessionName.classList.remove('text-neon');
    DOM.sessionName.classList.add('text-muted');
  }
}

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);
