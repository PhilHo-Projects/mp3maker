// Main downloader functionality

// DOM elements
const urlInput = document.getElementById('url');
const convertBtn = document.getElementById('download');
const downloadReadyBtn = document.getElementById('downloadReady');
const status = document.getElementById('status');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const statusText = document.getElementById('statusText');
const progressPercent = document.getElementById('progressPercent');
const progressSpeed = document.getElementById('progressSpeed');
const progressEta = document.getElementById('progressEta');
const thumbnailContainer = document.getElementById('thumbnailContainer');
const thumbnailImage = document.getElementById('thumbnailImage');
const thumbnailTitle = document.getElementById('thumbnailTitle');

let eventSource = null;
let currentSessionId = null;

// Convert button click handler
convertBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();

  if (!url) {
    showStatus('Please enter a SoundCloud or Bandcamp URL', 'error');
    return;
  }

  convertBtn.disabled = true;
  downloadReadyBtn.style.display = 'none';
  hideStatus();
  hideThumbnail();
  showProgress();
  resetProgress();
  currentSessionId = null;

  try {
    const response = await fetch(`${window.BASE_PATH}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Download failed');
    }

    const { sessionId } = await response.json();

    updateStatus('Starting conversion...', 0, null, null, true);
    connectToProgress(sessionId);
  } catch (error) {
    hideProgress();
    showStatus(error.message, 'error');
    convertBtn.disabled = false;
  }
});

// Connect to progress SSE stream
function connectToProgress(sessionId) {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`${window.BASE_PATH}/progress/${sessionId}`);

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.status === 'error' || data.error) {
      hideProgress();
      showStatus(data.message || data.error, 'error');
      convertBtn.disabled = false;
      eventSource.close();
    } else if (data.status === 'complete') {
      updateStatus(data.message || 'Ready to download!', 100);
      currentSessionId = sessionId;

      fetchThumbnail(sessionId);

      setTimeout(() => {
        hideProgress();
        downloadReadyBtn.style.display = 'block';
        convertBtn.disabled = false;
      }, 500);

      eventSource.close();
    } else {
      const percent = data.percent !== undefined ? data.percent : data.progress || 0;
      const message = data.message || data.status || 'Processing...';
      const isFetching = data.status === 'fetching';
      updateStatus(message, percent, data.speed, data.eta, isFetching);
    }
  };

  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    eventSource.close();
  };
}

// Download ready button click handler
downloadReadyBtn.addEventListener('click', () => {
  if (!currentSessionId) return;

  const link = document.createElement('a');
  link.href = `${window.BASE_PATH}/file/${currentSessionId}`;
  link.download = 'audio.mp3';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  downloadReadyBtn.style.display = 'none';
  hideThumbnail();
  showStatus('Downloaded! Check your Downloads folder', 'success');

  setTimeout(() => {
    hideStatus();
    currentSessionId = null;
  }, 3000);
});

// Update progress display
function updateStatus(statusMsg, progress, speed = null, eta = null, isFetching = false) {
  statusText.textContent = statusMsg;

  if (isFetching) {
    statusText.classList.add('loading');
    progressBar.classList.add('fetching');
  } else {
    statusText.classList.remove('loading');
    progressBar.classList.remove('fetching');
    progressBar.style.width = `${progress}%`;
  }

  progressPercent.textContent = `${Math.round(progress)}%`;

  if (speed) {
    progressSpeed.textContent = `⚡ ${speed}`;
  } else {
    progressSpeed.textContent = '';
  }

  if (eta) {
    progressEta.textContent = `⏱ ${eta}`;
  } else {
    progressEta.textContent = '';
  }

  if (progress === 100) {
    statusText.className = 'status-text success';
  } else {
    statusText.className = 'status-text';
  }
}

// Reset progress to initial state
function resetProgress() {
  updateStatus('Starting...', 0, null, null, true);
  statusText.className = 'status-text';
}

// UI helper functions
function showProgress() {
  progressContainer.classList.add('active');
}

function hideProgress() {
  progressContainer.classList.remove('active');
}

function showStatus(message, type) {
  status.textContent = message;
  status.className = `status ${type} active`;
}

function hideStatus() {
  status.className = 'status';
}

function showThumbnail() {
  thumbnailContainer.classList.add('active');
}

function hideThumbnail() {
  thumbnailContainer.classList.remove('active');
}

// Fetch and display thumbnail
async function fetchThumbnail(sessionId) {
  try {
    const response = await fetch(`${window.BASE_PATH}/thumbnail/${sessionId}`);
    if (response.ok) {
      const data = await response.json();
      thumbnailImage.src = data.thumbnailUrl;
      thumbnailImage.onerror = () => {
        thumbnailImage.src = `${window.BASE_PATH}/oops.jpg`;
      };
      showThumbnail();
    }
  } catch (error) {
    console.error('Failed to fetch thumbnail:', error);
    thumbnailImage.src = `${window.BASE_PATH}/oops.jpg`;
    showThumbnail();
  }
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (eventSource) {
    eventSource.close();
  }
});
