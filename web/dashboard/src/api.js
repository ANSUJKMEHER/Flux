// API client helper for Flux-GO Admin & Gateway endpoints

const TOKEN_KEY = 'flux_admin_token';
const DEMO_KEY = 'flux_demo_mode';

export function getAdminToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setAdminToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token.trim());
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getDemoMode() {
  return localStorage.getItem(DEMO_KEY) === 'true';
}

export function setDemoMode(enabled) {
  localStorage.setItem(DEMO_KEY, enabled ? 'true' : 'false');
}

export function getAdminBaseUrl() {
  // If running via Vite dev server (port 5173), target the admin port 9091
  if (window.location.port === '5173') {
    return 'http://localhost:9091';
  }
  return window.location.origin;
}

export function getGatewayBaseUrl() {
  // If running via Vite dev server (port 5173), target the gateway port 8085
  if (window.location.port === '5173') {
    return 'http://localhost:8085';
  }
  return window.location.origin;
}

function getHeaders() {
  const headers = {
    'Accept': 'application/json',
  };
  const token = getAdminToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchUpstreams() {
  const base = getAdminBaseUrl();
  const res = await fetch(`${base}/admin/upstreams`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function fetchBreakers() {
  const base = getAdminBaseUrl();
  const res = await fetch(`${base}/admin/breakers`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function fetchStats() {
  const base = getAdminBaseUrl();
  const res = await fetch(`${base}/admin/stats`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function fetchConfig() {
  const base = getAdminBaseUrl();
  const res = await fetch(`${base}/admin/config`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function injectChaos(upstream, errorRate) {
  // Map upstream ID or URL to appropriate chaos target
  let targetUrl = `/chaos/${upstream.id.replace(/users-|orders-|products-/, 'mock-')}`;
  const port = window.location.port;

  if (port === '9091' || port === '5173') {
    const chaosLocalPorts = {
      'upstream-a': 9001,
      'upstream-b': 9002,
      'upstream-c': 9003,
      'mock-a': 9001,
      'mock-b': 9002,
      'mock-c': 9003,
    };

    let targetPort = null;
    for (const [key, p] of Object.entries(chaosLocalPorts)) {
      if (upstream.url?.includes(key) || upstream.id?.includes(key)) {
        targetPort = p;
        break;
      }
    }
    // Fallback based on port in upstream.url if available
    if (!targetPort && upstream.url) {
      try {
        const u = new URL(upstream.url);
        if (u.port) targetPort = u.port;
      } catch {
        // ignore parse error
      }
    }

    if (targetPort) {
      targetUrl = `http://localhost:${targetPort}/chaos`;
    }
  }

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error_rate: errorRate }),
  });

  if (!res.ok) throw new Error(`Chaos injection failed: HTTP ${res.status}`);
  return res.json();
}

export async function sendTrafficRequest(endpoint, apiKey) {
  const base = getGatewayBaseUrl();
  const url = `${base}${endpoint}`;
  const headers = {};
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  const start = performance.now();
  let status = 0;
  let statusText = '';
  let responseHeaders = {};
  let data = null;
  let duration = 0;

  try {
    const res = await fetch(url, { headers });
    duration = Math.round(performance.now() - start);
    status = res.status;
    statusText = res.statusText || (status === 200 ? 'OK' : status === 429 ? 'Too Many Requests' : 'Response Received');
    
    // Extract Rate Limit headers
    res.headers.forEach((val, key) => {
      if (key.toLowerCase().startsWith('x-ratelimit') || key.toLowerCase() === 'retry-after') {
        responseHeaders[key] = val;
      }
    });

    try {
      data = await res.json();
    } catch {
      data = await res.text();
    }
  } catch (err) {
    duration = Math.round(performance.now() - start);
    status = 0;
    statusText = err.message || 'Network Error';
  }

  return {
    timestamp: new Date().toLocaleTimeString(),
    endpoint,
    status,
    statusText,
    duration,
    rateLimitHeaders: responseHeaders,
    body: data,
  };
}
