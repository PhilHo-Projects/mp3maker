// Shared configuration - loaded first before all other scripts
// Detect BASE_PATH from current URL (e.g., /mp3maker in production, empty in dev)

// Method 1: Try to detect from script tag (most reliable)
let detectedBasePath = '';
const scripts = document.getElementsByTagName('script');
for (let script of scripts) {
  const src = script.src;
  if (src && src.includes('config.js')) {
    const url = new URL(src);
    const pathParts = url.pathname.split('/');
    // Remove 'config.js' and empty strings
    const filtered = pathParts.filter(p => p && p !== 'config.js');
    if (filtered.length > 0) {
      detectedBasePath = '/' + filtered.join('/');
    }
    break;
  }
}

// Method 2: Fallback to pathname detection
if (!detectedBasePath) {
  const pathname = window.location.pathname;
  // If we're not at root and not at index.html directly
  if (pathname !== '/' && !pathname.endsWith('.html')) {
    const parts = pathname.split('/').filter(p => p);
    if (parts.length > 0) {
      detectedBasePath = '/' + parts[0];
    }
  }
}

// Set global BASE_PATH
window.BASE_PATH = detectedBasePath;

// Detect if running locally (localhost or 127.0.0.1)
window.IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

console.log('Config loaded:', { BASE_PATH: window.BASE_PATH, IS_LOCAL: window.IS_LOCAL });
