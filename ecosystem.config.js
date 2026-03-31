// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'mp3maker',
    script: './server.js',
    cwd: '/home/phil/projects/mp3maker',
    interpreter: '/usr/bin/node',
    env: {
      NODE_ENV: 'development',
      BASE_PATH: '',
      YTDLP_BIN: 'yt-dlp'
    },
    env_production: {
      NODE_ENV: 'production',
      BASE_PATH: '/mp3maker',
      YTDLP_BIN: 'yt-dlp'
    }
  }]
};
