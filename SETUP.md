# MP3 Maker Setup Guide

## Project Overview
- Port: `3003`
- Public path: local uses `/`, production uses `/mp3maker`
- Supported sources: SoundCloud and Bandcamp
- Runtime model: the app uses the system `yt-dlp` binary
- No YouTube cookies or sidecar provider are required

## Requirements
- Node.js `>= 18`
- `yt-dlp` installed on the host and available in `PATH`
- `ffmpeg` installed on the host and available in `PATH`

## Local Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Install `yt-dlp` and `ffmpeg` on your machine.
3. Start the app:
   ```bash
   npm start
   ```
4. Open `http://localhost:3003`

Optional local override:
```bash
YTDLP_BIN=/absolute/path/to/yt-dlp npm start
```

## Ubuntu Server Setup
1. Create the project directory:
   ```bash
   mkdir -p ~/projects/mp3maker
   cd ~/projects/mp3maker
   ```
2. Clone the repository the first time:
   ```bash
   git clone git@github.com:PhilippeHo27/mp3maker.git .
   ```
3. Install runtime dependencies:
   ```bash
   sudo apt update
   sudo apt install -y python3 python-is-python3 yt-dlp ffmpeg
   npm install --production
   ```
4. Start with PM2:
   ```bash
   pm2 start ecosystem.config.js --env production
   pm2 save
   pm2 startup
   ```

## Deployment
- Pushes to `main` trigger `.github/workflows/deploy.yml`
- The workflow:
  - pulls the latest code
  - installs `python3`, `yt-dlp`, and `ffmpeg`
  - installs production dependencies
  - restarts PM2 using `ecosystem.config.js`

## Health & Debugging
- `GET /health` returns a basic uptime check
- `GET /admin/health` returns:
  - supported platforms
  - configured `yt-dlp` command
  - resolved `yt-dlp` binary path
  - active `yt-dlp` version
  - server uptime
- The admin modal in the UI also shows live logs and the same runtime status

## Notes
- YouTube links are intentionally rejected for now
- SoundCloud and Bandcamp continue to use the same shared `yt-dlp` download pipeline
