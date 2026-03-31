const express = require('express');
const ytDlpExec = require('yt-dlp-exec');
const path = require('path');
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');

const YTDLP_COMMAND = process.env.YTDLP_BIN || process.env.YTDL_PATH || 'yt-dlp';
const ytDlp = typeof ytDlpExec.create === 'function'
  ? ytDlpExec.create(YTDLP_COMMAND)
  : ytDlpExec;

// Set ffmpeg location for yt-dlp (Windows winget install location)
// On Linux, ffmpeg should be in system PATH
if (process.env.LOCALAPPDATA) {
  const ffmpegPath = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-8.0-full_build', 'bin');
  if (fs.existsSync(path.join(ffmpegPath, 'ffmpeg.exe'))) {
    process.env.FFMPEG_PATH = ffmpegPath;
  }
}

const app = express();

// Configuration
const PORT = process.env.PORT || 3003;
const BASE_PATH = process.env.BASE_PATH || ''; // Empty for local, '/mp3maker' for production
const YOUTUBE_URL_PATTERN = /(?:youtube\.com|youtu\.be)/i;
const SOUNDCLOUD_URL_PATTERN = /soundcloud\.com/i;
const BANDCAMP_URL_PATTERN = /bandcamp\.com/i;
const SUPPORTED_PLATFORMS = Object.freeze(['soundcloud', 'bandcamp']);
const PLATFORM_LABELS = Object.freeze({
  soundcloud: 'SoundCloud',
  bandcamp: 'Bandcamp'
});
const YTDLP_STRATEGIES = Object.freeze({
  soundcloud: 'standard system yt-dlp extraction',
  bandcamp: 'standard system yt-dlp extraction',
  unknown: 'standard system yt-dlp extraction'
});

// Store active download sessions
const activeSessions = new Map();

// Store log history (keep last 500 lines)
const logHistory = [];
const MAX_LOG_HISTORY = 500;
const logClients = new Set();

// Middleware
app.use(express.json());
app.use(BASE_PATH, express.static('public'));

// Logging utility
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] ${message}`;
  console.log(logLine);

  // Store in history
  logHistory.push({ timestamp, level, message, full: logLine });
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory.shift();
  }

  // Broadcast to all log viewers
  const data = JSON.stringify({ timestamp, level, message, full: logLine });
  logClients.forEach(client => {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (err) {
      logClients.delete(client);
    }
  });
}

// Detect platform from URL using regex
function detectPlatform(url) {
  if (SOUNDCLOUD_URL_PATTERN.test(url)) return 'soundcloud';
  if (BANDCAMP_URL_PATTERN.test(url)) return 'bandcamp';
  return 'unknown';
}

function isYouTubeUrl(url) {
  return YOUTUBE_URL_PATTERN.test(url);
}

function getPlatformLabel(platform) {
  return PLATFORM_LABELS[platform] || 'audio source';
}

function getYtDlpStrategy(platform) {
  return YTDLP_STRATEGIES[platform] || YTDLP_STRATEGIES.unknown;
}

function resolveCommandPath(command) {
  if (!command) return 'unknown';
  if (path.isAbsolute(command) || /[\\/]/.test(command)) {
    return command;
  }

  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(locator, [command], { encoding: 'utf8' });

  if (result.status === 0) {
    const firstMatch = result.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean);

    if (firstMatch) {
      return firstMatch;
    }
  }

  return command;
}

function getYtDlpRuntimeInfo() {
  let version = 'unknown';

  try {
    version = execFileSync(YTDLP_COMMAND, ['--version'], { encoding: 'utf8' }).trim();
  } catch (err) {
    // The health endpoint returns "unknown" if the binary is missing.
  }

  return {
    command: YTDLP_COMMAND,
    resolvedPath: resolveCommandPath(YTDLP_COMMAND),
    version
  };
}

function buildYtDlpOptions({ metadataOnly = false, tempFileBase = null } = {}) {
  const options = {
    noWarnings: true,
    noCheckCertificate: true,
    noPlaylist: true
  };

  if (metadataOnly) {
    return {
      ...options,
      dumpSingleJson: true
    };
  }

  return {
    ...options,
    extractAudio: true,
    audioFormat: 'mp3',
    audioQuality: '320k',
    format: 'bestaudio/best',
    addMetadata: true,
    embedThumbnail: true,
    output: tempFileBase,
    ...(process.env.FFMPEG_PATH && { ffmpegLocation: process.env.FFMPEG_PATH })
  };
}

// Normalize common yt-dlp failures into source-agnostic user messages.
function getErrorMessage(error, exitCode = null) {
  const errorMsg = [
    typeof error === 'string' ? error : null,
    error?.message,
    error?.stderr,
    error?.stdout
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (errorMsg.includes('requested format is not available') ||
      errorMsg.includes('only images are available')) {
    return 'No downloadable audio stream was available for this source.';
  }
  if (errorMsg.includes('geo') || errorMsg.includes('not available in your')) {
    return 'This source is not available in your region.';
  }
  if (errorMsg.includes('copyright')) {
    return 'This source is unavailable due to copyright restrictions.';
  }
  if (errorMsg.includes('members-only') || errorMsg.includes('members only')) {
    return 'This source requires an account or membership and cannot be downloaded.';
  }
  if (errorMsg.includes('private') || errorMsg.includes('unavailable')) {
    return 'This source is private or unavailable.';
  }
  if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
    return 'Download timed out. The source may be too large or slow to respond.';
  }
  if (errorMsg.includes('network') || errorMsg.includes('enotfound') || errorMsg.includes('eai_again')) {
    return 'Network error. Please check your internet connection.';
  }
  if (exitCode === 1) {
    return 'Download failed. The source may be unavailable or temporarily blocked.';
  }

  return error?.message || 'An unknown download error occurred.';
}

// Sanitize filename to remove invalid characters
function sanitizeFilename(filename) {
  return filename.replace(/[^\w\s-]/gi, '').trim().substring(0, 100);
}

// Send SSE progress update
function sendProgress(sessionId, data) {
  const session = activeSessions.get(sessionId);
  if (session && session.res) {
    session.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

// Wait for SSE connection to be established
function waitForSSEConnection(sessionId, maxWaitMs = 5000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      const session = activeSessions.get(sessionId);
      if (session && session.res) {
        clearInterval(checkInterval);
        resolve(true);
      } else if (Date.now() - startTime > maxWaitMs) {
        clearInterval(checkInterval);
        log(`SSE connection timeout for session: ${sessionId}`, 'WARN');
        resolve(false);
      }
    }, 50);
  });
}

// Unified download function using yt-dlp for supported audio sources.
async function downloadAudio(url, sessionId, platform) {
  const tempFileBase = path.join(__dirname, 'public', 'temp', `temp-${sessionId}`);
  const tempFile = `${tempFileBase}.mp3`;
  let trackTitle = 'audio';
  let thumbnailUrl = null;
  const platformLabel = getPlatformLabel(platform);
  const strategy = getYtDlpStrategy(platform);

  sendProgress(sessionId, {
    status: 'fetching',
    percent: 0,
    message: `🔍 Connecting to ${platformLabel}...`
  });

  return new Promise(async (resolve, reject) => {
    let countdownInterval;

    try {
      log(`Using yt-dlp strategy for ${platform}: ${strategy}`, 'INFO');
      log(`Starting info fetch for [${platform}]: ${url}`, 'INFO');
      sendProgress(sessionId, {
        status: 'fetching',
        percent: 2,
        message: `📡 Fetching ${platformLabel} info...`
      });

      let countdown = 30;
      countdownInterval = setInterval(() => {
        countdown--;
        if (countdown > 0) {
          sendProgress(sessionId, {
            status: 'fetching',
            percent: 2 + ((30 - countdown) / 30 * 3),
            message: `📡 Fetching ${platformLabel} info... (${countdown}s)`
          });
        }
      }, 1000);

      const titleOutput = await Promise.race([
        ytDlp(url, buildYtDlpOptions({ metadataOnly: true })),
        new Promise((_, timeoutReject) =>
          setTimeout(() => timeoutReject(new Error('Info fetch timeout after 30s')), 30000)
        )
      ]);

      if (countdownInterval) clearInterval(countdownInterval);

      if (titleOutput && titleOutput.title) {
        trackTitle = sanitizeFilename(titleOutput.title);
        log(`Track title: ${trackTitle}`);

        if (titleOutput.thumbnail) {
          thumbnailUrl = titleOutput.thumbnail;
          log(`Thumbnail URL: ${thumbnailUrl}`);
        } else if (titleOutput.thumbnails && titleOutput.thumbnails.length > 0) {
          const bestThumbnail = titleOutput.thumbnails[titleOutput.thumbnails.length - 1];
          thumbnailUrl = bestThumbnail.url;
          log(`Thumbnail URL: ${thumbnailUrl}`);
        }

        sendProgress(sessionId, {
          status: 'fetching',
          percent: 5,
          message: `✨ Found: ${trackTitle.substring(0, 40)}${trackTitle.length > 40 ? '...' : ''}`
        });
      }
      log('Info fetch completed successfully', 'INFO');
    } catch (err) {
      if (countdownInterval) clearInterval(countdownInterval);
      log(`Could not fetch title via ${strategy}: ${err.message}`, 'WARN');
    }

    sendProgress(sessionId, {
      status: 'fetching',
      percent: 8,
      message: '🎵 Preparing download...'
    });

    const ytDlpProcess = ytDlp.exec(url, buildYtDlpOptions({ tempFileBase }));
    let stdoutOutput = '';
    let stderrOutput = '';

    const session = activeSessions.get(sessionId);
    if (session) {
      session.ytDlpProcess = ytDlpProcess;
      session.tempFileBase = tempFileBase;
    }

    if (ytDlpProcess.stdout) {
      ytDlpProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdoutOutput += output;
        log(`yt-dlp: ${output.trim()}`);

        if (output.includes('Extracting URL')) {
          sendProgress(sessionId, {
            status: 'fetching',
            percent: 10,
            message: '🔗 Extracting URL...'
          });
        } else if (output.includes('Downloading webpage')) {
          sendProgress(sessionId, {
            status: 'fetching',
            percent: 15,
            message: '📄 Loading webpage...'
          });
        } else if (output.includes('Downloading tv client config') || output.includes('Downloading player config')) {
          sendProgress(sessionId, {
            status: 'fetching',
            percent: 20,
            message: '⚙️ Loading config...'
          });
        } else if (output.includes('player API JSON')) {
          sendProgress(sessionId, {
            status: 'fetching',
            percent: 25,
            message: '🎬 Loading player API...'
          });
        } else if (output.includes('Downloading m3u8 information')) {
          sendProgress(sessionId, {
            status: 'fetching',
            percent: 30,
            message: '📊 Analyzing streams...'
          });
        } else if (output.includes('Downloading 1 format')) {
          sendProgress(sessionId, {
            status: 'fetching',
            percent: 35,
            message: '✅ Format selected!'
          });
        }

        const sleepMatch = output.match(/Sleeping\s+(\d+\.?\d*)\s+seconds/);
        if (sleepMatch) {
          const sleepSeconds = parseFloat(sleepMatch[1]);
          let countdown = Math.ceil(sleepSeconds);

          sendProgress(sessionId, {
            status: 'fetching',
            percent: 10,
            message: `⏳ Rate limit: ${countdown}s...`
          });

          const sleepCountdownInterval = setInterval(() => {
            countdown--;
            if (countdown > 0) {
              sendProgress(sessionId, {
                status: 'fetching',
                percent: 10 + ((sleepSeconds - countdown) / sleepSeconds) * 5,
                message: `⏳ Rate limit: ${countdown}s...`
              });
            } else {
              clearInterval(sleepCountdownInterval);
            }
          }, 1000);
        }

        const progressMatch = output.match(/(\d+\.?\d*)%/);
        const speedMatch = output.match(/(\d+\.?\d*[KMG]iB\/s)/);
        const etaMatch = output.match(/ETA\s+(\d+:\d+)/);

        if (progressMatch) {
          const percent = parseFloat(progressMatch[1]);

          let status = 'downloading';
          let message = 'Downloading...';

          if (output.includes('[download]')) {
            status = 'downloading';
            message = 'Downloading...';
          } else if (output.includes('Extracting audio')) {
            status = 'converting';
            message = 'Converting to MP3...';
          } else if (output.includes('Deleting') || output.includes('has already been downloaded')) {
            status = 'converting';
            message = 'Converting to MP3...';
          }

          sendProgress(sessionId, {
            status,
            percent: Math.min(percent, 99),
            message,
            speed: speedMatch ? speedMatch[1] : null,
            eta: etaMatch ? etaMatch[1] : null
          });
        } else if (output.includes('Extracting audio') || output.includes('[ExtractAudio]')) {
          sendProgress(sessionId, {
            status: 'converting',
            percent: 95,
            message: 'Converting to MP3...'
          });
        }
      });
    }

    if (ytDlpProcess.stderr) {
      ytDlpProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderrOutput += output;
        log(`yt-dlp stderr: ${output.trim()}`, 'WARN');
      });
    }

    ytDlpProcess.on('close', (code) => {
      if (code === 0) {
        sendProgress(sessionId, {
          status: 'complete',
          percent: 100,
          message: 'Complete!'
        });

        const activeSession = activeSessions.get(sessionId);
        if (activeSession) {
          activeSession.trackTitle = trackTitle;
          activeSession.thumbnailUrl = thumbnailUrl;
        }
        resolve(tempFile);
      } else {
        const details = stderrOutput.trim() || stdoutOutput.trim();
        reject(new Error(`yt-dlp process failed with exit code ${code}${details ? `: ${details}` : ''}`));
      }
    });

    ytDlpProcess.on('error', (err) => {
      reject(err);
    });
  });
}

// SSE endpoint for progress updates
app.get(`${BASE_PATH}/progress/:sessionId`, (req, res) => {
  const { sessionId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (!activeSessions.has(sessionId)) {
    activeSessions.set(sessionId, {});
  }
  activeSessions.get(sessionId).res = res;

  res.write(`data: ${JSON.stringify({ status: 'fetching', percent: 0, message: 'Preparing...' })}\n\n`);

  req.on('close', () => {
    const session = activeSessions.get(sessionId);
    if (session) {
      if (session.ytDlpProcess) {
        try {
          session.ytDlpProcess.kill('SIGTERM');
          log(`Killed yt-dlp process for disconnected session: ${sessionId}`, 'WARN');
        } catch (err) {
          log(`Error killing process: ${err.message}`, 'ERROR');
        }
      }

      if (session.tempFileBase && !session.tempFile) {
        const possibleFiles = [
          session.tempFileBase,
          `${session.tempFileBase}.mp3`,
          `${session.tempFileBase}.jpg`,
          `${session.tempFileBase}.webp`,
          `${session.tempFileBase}.png`
        ];

        possibleFiles.forEach(file => {
          if (fs.existsSync(file)) {
            try {
              fs.unlinkSync(file);
              log(`Cleaned up orphaned file: ${path.basename(file)}`, 'INFO');
            } catch (err) {
              log(`Error cleaning file: ${err.message}`, 'ERROR');
            }
          }
        });
      }

      delete session.res;
      delete session.ytDlpProcess;
    }
    log(`SSE connection closed for session: ${sessionId}`);
  });
});

// Download endpoint
app.post(`${BASE_PATH}/download`, async (req, res) => {
  const startTime = Date.now();
  const sessionId = Date.now().toString();
  let tempFile = null;
  let exitCode = null;

  try {
    const { url } = req.body;
    const normalizedUrl = typeof url === 'string' ? url.trim() : '';

    if (!normalizedUrl) {
      log(`Invalid URL attempted: ${url}`, 'WARN');
      return res.status(400).json({ error: 'Please provide a valid URL' });
    }

    if (isYouTubeUrl(normalizedUrl)) {
      return res.status(400).json({
        error: 'YouTube links are temporarily unsupported. Please use SoundCloud or Bandcamp.'
      });
    }

    const platform = detectPlatform(normalizedUrl);

    if (platform === 'unknown') {
      return res.status(400).json({ error: 'Unsupported URL. Please use SoundCloud or Bandcamp links.' });
    }

    log(`Download request [${platform}]: ${normalizedUrl}`);

    res.json({ sessionId, platform });

    if (!activeSessions.has(sessionId)) {
      activeSessions.set(sessionId, {});
    }
    activeSessions.get(sessionId).url = normalizedUrl;
    activeSessions.get(sessionId).platform = platform;

    await waitForSSEConnection(sessionId);

    tempFile = await downloadAudio(normalizedUrl, sessionId, platform);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`Download completed in ${duration}s [${platform}]`, 'SUCCESS');

    activeSessions.get(sessionId).tempFile = tempFile;
  } catch (error) {
    log(`Error: ${error.message}`, 'ERROR');

    const exitCodeMatch = error.message.match(/exit code (\d+)/);
    if (exitCodeMatch) {
      exitCode = parseInt(exitCodeMatch[1], 10);
    }

    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }

    sendProgress(sessionId, {
      status: 'error',
      percent: 0,
      message: getErrorMessage(error, exitCode),
      error: getErrorMessage(error, exitCode)
    });
  }
});

// File retrieval endpoint
app.get(`${BASE_PATH}/file/:sessionId`, (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);

  if (!session || !session.tempFile) {
    return res.status(404).json({ error: 'File not found or expired' });
  }

  const tempFile = session.tempFile;

  if (!fs.existsSync(tempFile)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const trackTitle = session.trackTitle || 'audio';
  const filename = `${trackTitle}.mp3`;

  res.download(tempFile, filename, (err) => {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
      log('Temp file deleted');
    }

    activeSessions.delete(sessionId);

    if (err) {
      log(`Download error: ${err.message}`, 'ERROR');
    }
  });
});

// Thumbnail endpoint
app.get(`${BASE_PATH}/thumbnail/:sessionId`, (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const thumbnailUrl = session.thumbnailUrl || `${BASE_PATH}/oops.jpg`;
  res.json({ thumbnailUrl });
});

// Health check endpoint
app.get(`${BASE_PATH}/health`, (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Admin: Health check endpoint
// TODO: Add authentication in production
app.get(`${BASE_PATH}/admin/health`, async (req, res) => {
  try {
    const ytdlp = getYtDlpRuntimeInfo();

    res.json({
      supportedPlatforms: SUPPORTED_PLATFORMS,
      ytdlp: {
        command: ytdlp.command,
        resolvedPath: ytdlp.resolvedPath,
        version: ytdlp.version
      },
      server: {
        uptimeSeconds: Math.round(process.uptime())
      }
    });
  } catch (error) {
    log(`Admin health check error: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Failed to get health status' });
  }
});

// Admin: Real-time logs endpoint (SSE)
// TODO: Add authentication in production
app.get(`${BASE_PATH}/admin/logs`, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  logHistory.forEach(entry => {
    const data = JSON.stringify(entry);
    res.write(`data: ${data}\n\n`);
  });

  logClients.add(res);
  log(`Admin log viewer connected (${logClients.size} active)`, 'INFO');

  req.on('close', () => {
    logClients.delete(res);
    log(`Admin log viewer disconnected (${logClients.size} active)`, 'INFO');
  });
});

// Clean up orphaned temp files on startup
function cleanupTempFiles() {
  const tempDir = path.join(__dirname, 'public', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    return;
  }
  const files = fs.readdirSync(tempDir);
  let cleaned = 0;
  files.forEach(file => {
    if (file.startsWith('temp-') && (
      file.endsWith('.mp3') ||
      file.endsWith('.jpg') ||
      file.endsWith('.webp') ||
      file.endsWith('.png') ||
      file.match(/^temp-\d+$/)
    )) {
      try {
        fs.unlinkSync(path.join(tempDir, file));
        cleaned++;
      } catch (err) {
        // Ignore cleanup errors on startup
      }
    }
  });
  if (cleaned > 0) {
    log(`Cleaned up ${cleaned} orphaned temp file(s)`, 'INFO');
  }
}

// Start server
cleanupTempFiles();
app.listen(PORT, () => {
  const ytdlp = getYtDlpRuntimeInfo();
  log(`Server running on http://localhost:${PORT}`, 'SUCCESS');
  log(`Supports: ${SUPPORTED_PLATFORMS.map(getPlatformLabel).join(' & ')}`, 'INFO');
  log('Output: CBR 320kbps MP3', 'INFO');
  log(`yt-dlp command: ${ytdlp.command}`, 'INFO');
  log(`yt-dlp resolved path: ${ytdlp.resolvedPath}`, 'INFO');
  if (ytdlp.version === 'unknown') {
    log('Could not determine yt-dlp version at startup', 'WARN');
  } else {
    log(`yt-dlp version: ${ytdlp.version}`, 'INFO');
  }
  log('Press Ctrl+C to stop the server');
});
