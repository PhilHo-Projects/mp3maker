# MP3 Maker

MP3 Maker converts public SoundCloud and Bandcamp tracks to high-bitrate MP3 with live progress updates and a simple admin log view.

## Supported Sources
- SoundCloud tracks
- Bandcamp tracks
- MP3 output with metadata and embedded thumbnails when available
- Real-time progress updates over Server-Sent Events

## Requirements
- Node.js `>= 18`
- `yt-dlp` available in `PATH`
- `ffmpeg` available in `PATH`

## Install
1. Install dependencies:
   ```bash
   npm install
   ```
2. Install system tools:
   ```bash
   yt-dlp --version
   ffmpeg -version
   ```
3. Start the app:
   ```bash
   npm start
   ```
4. Open `http://localhost:3003`

## Runtime Configuration
- `PORT`: server port, defaults to `3003`
- `BASE_PATH`: empty locally, `/mp3maker` in production
- `YTDLP_BIN`: optional explicit path or command for the `yt-dlp` binary

Example:
```bash
YTDLP_BIN=/usr/bin/yt-dlp PORT=3003 npm start
```

## Ubuntu / PM2
Install runtime packages on the host:
```bash
sudo apt update
sudo apt install -y python3 python-is-python3 yt-dlp ffmpeg
```

Start the app with PM2:
```bash
pm2 start ecosystem.config.js --env production
pm2 save
```

## How It Works
- Express serves the UI and download endpoints
- `yt-dlp-exec` calls the system `yt-dlp` binary
- The backend fetches metadata first, then downloads and converts to MP3
- The frontend listens to progress over SSE and downloads the finished file from `/file/:sessionId`

## API Endpoints
- `POST /download`: starts a download and returns `{ sessionId, platform }`
- `GET /progress/:sessionId`: SSE stream for progress events
- `GET /file/:sessionId`: downloads the final MP3 file
- `GET /thumbnail/:sessionId`: returns the session thumbnail URL
- `GET /health`: basic health check
- `GET /admin/health`: returns `supportedPlatforms`, `ytdlp`, and `server`
- `GET /admin/logs`: SSE log stream for the admin modal

## Troubleshooting
### YouTube links
YouTube links are intentionally unsupported for now. The app only accepts SoundCloud and Bandcamp URLs.

### `yt-dlp` not found
Install `yt-dlp` on the host and make sure it is available in `PATH`, or set `YTDLP_BIN`.

### `ffmpeg` not found
Install `ffmpeg` on the host so `yt-dlp` can extract audio and embed thumbnails.

## Project Files
- `server.js`: Express backend and download pipeline
- `public/`: frontend assets
- `ecosystem.config.js`: PM2 runtime configuration
- `.github/workflows/deploy.yml`: deployment workflow

## License
MIT
