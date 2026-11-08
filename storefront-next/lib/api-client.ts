const API_BASE = process.env.NEXT_PUBLIC_HIRO_API_BASE ?? (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '');
let csrfToken: string | null = null;

async function refreshCsrfToken() {
  const response = await fetch(`${API_BASE}/csrf-token`, { credentials: 'include', headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.csrfToken) throw new Error('Unable to prepare a secure session. Refresh the page and try again.');
  csrfToken = String(data.csrfToken);
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const needsToken = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (needsToken && !csrfToken) await refreshCsrfToken();
  const headers = new Headers(options.headers || {});
  headers.set('Accept', headers.get('Accept') || 'application/json');
  if (needsToken && csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`${API_BASE}${path}`, { ...options, method, headers, credentials: 'include' });
  if (needsToken && response.status === 403) {
    await refreshCsrfToken();
    headers.set('X-CSRF-Token', csrfToken || '');
    return fetch(`${API_BASE}${path}`, { ...options, method, headers, credentials: 'include' });
  }
  return response;
}

export { API_BASE };
