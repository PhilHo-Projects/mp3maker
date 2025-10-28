// Admin panel functionality

// Use BASE_PATH from config.js
const BASE_PATH = window.BASE_PATH || '';

// DOM elements
const adminBtn = document.getElementById('adminBtn');
const adminModal = document.getElementById('adminModal');
const closeModal = document.getElementById('closeModal');
const logsContainer = document.getElementById('logsContainer');
const clearLogsBtn = document.getElementById('clearLogs');

// Main screen cookie helper elements
const mainHealthDisplay = document.getElementById('mainHealthDisplay');
const mainCookieTextarea = document.getElementById('mainCookieTextarea');
const mainUpdateCookiesBtn = document.getElementById('mainUpdateCookiesBtn');
const mainCookieStatus = document.getElementById('mainCookieStatus');

let logEventSource = null;

// Escape key closes admin panel
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && adminModal.classList.contains('active')) {
    event.preventDefault();
    adminModal.classList.remove('active');
    disconnectFromLogs();
  }
});

// Open admin modal (for button if needed)
adminBtn.addEventListener('click', () => {
  adminModal.classList.add('active');
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

// Load health status for main screen
async function loadMainHealthStatus() {
  if (!mainHealthDisplay) return;
  mainHealthDisplay.innerHTML = '<div class="health-item">Loading...</div>';
  
  try {
    const response = await fetch(`${BASE_PATH}/admin/health`);
    if (!response.ok) throw new Error('Failed to load health status');
    
    const data = await response.json();
    
    let html = '';
    
    // Cookies status
    if (data.cookies.exists) {
      const age = data.cookies.ageInDays;
      const icon = age < 30 ? '✅' : age < 60 ? '⚠️' : '❌';
      html += `<div class="health-item"><span class="health-icon">${icon}</span> Cookies: Present (${age} days old)</div>`;
    } else {
      html += '<div class="health-item"><span class="health-icon">❌</span> Cookies: Not found</div>';
    }
    
    // yt-dlp version
    html += `<div class="health-item"><span class="health-icon">✅</span> yt-dlp: ${data.ytdlp.version}</div>`;
    
    // Server uptime
    const uptimeHours = Math.floor(data.server.uptimeSeconds / 3600);
    const uptimeDays = Math.floor(uptimeHours / 24);
    const remainingHours = uptimeHours % 24;
    const uptimeStr = uptimeDays > 0 
      ? `${uptimeDays} days, ${remainingHours} hours`
      : `${uptimeHours} hours`;
    html += `<div class="health-item"><span class="health-icon">✅</span> Server uptime: ${uptimeStr}</div>`;
    
    mainHealthDisplay.innerHTML = html;
  } catch (error) {
    mainHealthDisplay.innerHTML = `<div class="health-item"><span class="health-icon">❌</span> Error: ${error.message}</div>`;
  }
}

// Update cookies from main screen
if (mainUpdateCookiesBtn) {
  mainUpdateCookiesBtn.addEventListener('click', async () => {
    const cookieContent = mainCookieTextarea.value.trim();
    
    if (!cookieContent) {
      showMainCookieStatus('Please paste cookie content', 'error');
      return;
    }
    
    mainUpdateCookiesBtn.disabled = true;
    mainUpdateCookiesBtn.textContent = 'Updating...';
    
    try {
      const response = await fetch(`${BASE_PATH}/admin/update-cookies`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: cookieContent
      });
      
      const result = await response.json();
      
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to update cookies');
      }
      
      showMainCookieStatus('✅ Cookies updated successfully!', 'success');
      mainCookieTextarea.value = '';
      
      // Refresh health status
      setTimeout(() => loadMainHealthStatus(), 500);
      
      // Hide the entire cookie helper section after successful update
      if (typeof hideCookieHelper === 'function') {
        setTimeout(() => hideCookieHelper(), 2000); // Give user time to see success message
      }
      
    } catch (error) {
      showMainCookieStatus(`❌ Error: ${error.message}`, 'error');
    } finally {
      mainUpdateCookiesBtn.disabled = false;
      mainUpdateCookiesBtn.textContent = 'Update Cookies';
    }
  });
}

// Show main cookie status message
function showMainCookieStatus(message, type) {
  if (!mainCookieStatus) return;
  mainCookieStatus.textContent = message;
  mainCookieStatus.className = `cookie-update-status ${type} active`;
  
  setTimeout(() => {
    mainCookieStatus.classList.remove('active');
  }, 5000);
}

// ===== LOG VIEWER FUNCTIONALITY =====

// Connect to log stream
function connectToLogs() {
  if (logEventSource) return; // Already connected
  
  logsContainer.innerHTML = '<div class="log-line">Connecting to log stream...</div>';
  
  logEventSource = new EventSource(`${BASE_PATH}/admin/logs`);
  
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
  // Clear "connecting" message on first real log
  if (logsContainer.children.length === 1 && 
      logsContainer.children[0].textContent.includes('Connecting')) {
    logsContainer.innerHTML = '';
  }
  
  const logLine = document.createElement('div');
  logLine.className = `log-line ${log.level}`;
  logLine.textContent = log.full;
  
  logsContainer.appendChild(logLine);
  
  // Auto-scroll to bottom
  logsContainer.scrollTop = logsContainer.scrollHeight;
  
  // Limit to 500 lines in UI
  while (logsContainer.children.length > 500) {
    logsContainer.removeChild(logsContainer.firstChild);
  }
}

// Clear logs display
clearLogsBtn.addEventListener('click', () => {
  logsContainer.innerHTML = '<div class="log-line">Logs cleared (new logs will appear below)</div>';
});
