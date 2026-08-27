async function request(url, options) {
  const res = await fetch(url, options);
  let body = null;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Respon tidak valid (${res.status})`);
  }
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export function fetchStatus() {
  return request('/api/status');
}

export function processAction(pmId, action) {
  return request(`/api/processes/${pmId}/${action}`, { method: 'POST' });
}

export function addBot(payload) {
  return request('/api/processes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function savePm2() {
  return request('/api/pm2/save', { method: 'POST' });
}

export function fetchLogs(name, stream, lines) {
  const q = new URLSearchParams({ name, stream, lines: String(lines) });
  return request(`/api/logs?${q.toString()}`);
}

export function fetchAllLogs(stream, lines) {
  const q = new URLSearchParams({ stream, lines: String(lines) });
  return request(`/api/logs/all?${q.toString()}`);
}

export function fetchActivity() {
  return request('/api/activity');
}

export function openFolder(body) {
  return request('/api/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export function fetchIncidents() {
  return request('/api/incidents');
}

export function clearIncidents() {
  return request('/api/incidents/clear', { method: 'POST' });
}

export function setLock(locked) {
  return request('/api/lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locked })
  });
}

export function fetchTunnelInfo() {
  return request('/api/tunnel-info');
}

export function updateProcess(pmId, data) {
  return request(`/api/processes/${pmId}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export function restartTunnel() {
  return request('/api/tunnel/restart', { method: 'POST' });
}

export function checkMe() {
  return request('/api/me');
}

export function doLogin(user, pass) {
  return request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, pass })
  });
}

export function doLogout() {
  return request('/api/logout', { method: 'POST' });
}

export function fetchLoginLog() {
  return request('/api/login-log');
}

export function fetchNetwork() {
  return request('/api/network');
}

export function fetchFileList(dir) {
  return request('/api/files/list' + (dir ? `?dir=${encodeURIComponent(dir)}` : ''));
}

export function readFile(p) {
  return request('/api/file/read?p=' + encodeURIComponent(p));
}

export function saveFile(p, content) {
  return request('/api/file/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p, content })
  });
}

export function fetchBotQr(id) {
  return request('/api/botqr/' + id);
}
