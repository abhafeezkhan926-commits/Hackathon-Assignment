const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '');

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (options.body !== undefined && !isFormData && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response;
  try {
    response = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
      ...options,
      headers,
      credentials: 'include',
      body: options.body !== undefined && !isFormData && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
    });
  } catch {
    throw new Error('Cannot reach the server. Check that the HCM Lite API is running and the API URL is correct.');
  }
  let payload = {};
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error?.message || payload.message || `Request failed (${response.status}).`);
    error.status = response.status;
    error.details = payload.error?.details;
    error.code = payload.error?.details?.code;
    throw error;
  }
  return payload.data ?? payload;
}

export async function downloadFile(path, filename) {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!response.ok) {
    let message = `Download failed (${response.status}).`;
    try { const body = await response.json(); message = body.error?.message || message; } catch {}
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}
