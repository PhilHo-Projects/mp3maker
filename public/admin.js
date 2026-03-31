// Admin panel functionality

// DOM elements
const adminBtn = document.getElementById('adminBtn');
const adminModal = document.getElementById('adminModal');
const closeModal = document.getElementById('closeModal');
const logsContainer = document.getElementById('logsContainer');
const clearLogsBtn = document.getElementById('clearLogs');
const adminHealthDisplay = document.getElementById('adminHealthDisplay');
const PLATFORM_LABELS = {
  soundcloud: 'SoundCloud',
  bandcamp: 'Bandcamp'
};

let logEventSource = null;

// Escape key closes admin panel
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && adminModal.classList.contains('active')) {
    event.preventDefault();
    adminModal.classList.remove('active');
    disconnectFromLogs();
  }
});

async function loadAdminHealthStatus() {
  if (!adminHealthDisplay) return;
  adminHealthDisplay.innerHTML = '<div class="health-item">Loading...</div>';

  try {
    const response = await fetch(`${window.BASE_PATH}/admin/health`);
    if (!response.ok) throw new Error('Failed to load health status');

    const data = await response.json();
    const uptimeHours = Math.floor(data.server.uptimeSeconds / 3600);
    const uptimeDays = Math.floor(uptimeHours / 24);
    const remainingHours = uptimeHours % 24;
    const uptimeStr = uptimeDays > 0
      ? `${uptimeDays} days, ${remainingHours} hours`
      : `${uptimeHours} hours`;
    const binaryPath = data.ytdlp.resolvedPath || data.ytdlp.command || 'unknown';
    const supportedPlatforms = (data.supportedPlatforms || [])
      .map((platform) => PLATFORM_LABELS[platform] || platform)
      .join(', ') || 'Unknown';

    adminHealthDisplay.innerHTML = `
      <div class="health-item"><span class="health-icon">✅</span> Supported sources: ${supportedPlatforms}</div>
      <div class="health-item"><span class="health-icon">✅</span> yt-dlp version: ${data.ytdlp.version}</div>
      <div class="health-item"><span class="health-icon">✅</span> yt-dlp binary: ${binaryPath}</div>
      <div class="health-item"><span class="health-icon">✅</span> Server uptime: ${uptimeStr}</div>
    `;
  } catch (error) {
    adminHealthDisplay.innerHTML = `<div class="health-item"><span class="health-icon">❌</span> Error: ${error.message}</div>`;
  }
}

// Open admin modal
adminBtn.addEventListener('click', () => {
  adminModal.classList.add('active');
  loadAdminHealthStatus();
  connectToLogs();
});

// Close modal
closeModal.addEventListener('click', () => {
  adminModal.classList.remove('active');
  disconnectFromLogs();
});

// Close modal when clicking outside
adminModal.addEventListener('click', (e) => {
  if (e.target === adminModal) {
    adminModal.classList.remove('active');
    disconnectFromLogs();
  }
});

// Connect to log stream
function connectToLogs() {
  if (logEventSource) return;

  logsContainer.innerHTML = '<div class="log-line">Connecting to log stream...</div>';

  logEventSource = new EventSource(`${window.BASE_PATH}/admin/logs`);

  logEventSource.onmessage = (event) => {
    const log = JSON.parse(event.data);
    addLogLine(log);
  };

  logEventSource.onerror = () => {
    if (logsContainer.children.length === 0) {
      logsContainer.innerHTML = '<div class="log-line ERROR">Connection failed</div>';
    }
  };
}

// Disconnect from log stream
function disconnectFromLogs() {
  if (logEventSource) {
    logEventSource.close();
    logEventSource = null;
  }
}

// Add a log line to the display
function addLogLine(log) {
  if (logsContainer.children.length === 1 &&
      logsContainer.children[0].textContent.includes('Connecting')) {
    logsContainer.innerHTML = '';
  }

  const logLine = document.createElement('div');
  logLine.className = `log-line ${log.level}`;
  logLine.textContent = log.full;

  logsContainer.appendChild(logLine);
  logsContainer.scrollTop = logsContainer.scrollHeight;

  while (logsContainer.children.length > 500) {
    logsContainer.removeChild(logsContainer.firstChild);
  }
}

// Clear logs display
clearLogsBtn.addEventListener('click', () => {
  logsContainer.innerHTML = '<div class="log-line">Logs cleared (new logs will appear below)</div>';
});
