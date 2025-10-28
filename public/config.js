// Shared configuration - loaded first before all other scripts
// Detect BASE_PATH from current URL (e.g., /mp3maker in production, empty in dev)

let detectedBasePath = '';

// Simple detection: check if URL contains /mp3maker
const pathname = window.location.pathname;
if (pathname.startsWith('/mp3maker')) {
  detectedBasePath = '/mp3maker';
}
// For local development (localhost), BASE_PATH is empty
// For production, it will be /mp3maker

// Set global BASE_PATH
window.BASE_PATH = detectedBasePath;

// Detect if running locally (localhost or 127.0.0.1)
window.IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

console.log('Config loaded:', { BASE_PATH: window.BASE_PATH, IS_LOCAL: window.IS_LOCAL });
