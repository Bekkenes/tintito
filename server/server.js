import { join, normalize, resolve, sep, extname } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { TelnetFilter, encodeInput } from './telnet.js';

const ROOT = resolve(import.meta.dir, '..');
const PUBLIC = join(ROOT, 'public');
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === '1';
const CONNECT_TIMEOUT_MS = 12000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "font-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; " +
    "base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS },
  });
}

function cleanHost(input) {
  if (typeof input !== 'string') return null;
  let host = input.trim();
  if (!host || host.length > 253) return null;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!/^[a-zA-Z0-9._:\-]+$/.test(host)) {
    // allow IDN names by punycoding first
    try {
      host = new URL(`http://${host}`).hostname;
    } catch {
      return null;
    }
  }
  if (!host || /[/\\@\s]/.test(host)) return null;
  return host;
}

function isPrivateIp(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier NAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    if (s.startsWith('::ffff:')) return isPrivateIp(s.slice(7));
    if (s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return true;
    if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique local
    if (s.startsWith('ff')) return true; // multicast
    return false;
  }
  return true; // not an IP -> caller should have resolved it
}

async function assertHostAllowed(host, port) {
  if (port < 1 || port > 65535) throw new Error('Invalid port.');
  if (ALLOW_PRIVATE) return;
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Private addresses are disabled on this server.');
    return;
  }
  let addresses;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('Could not resolve that host.');
  }
  if (!addresses.length) throw new Error('Could not resolve that host.');
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error('That host resolves to a private address; this bridge blocks those.');
  }
}

function safeStaticPath(pathname) {
  let p;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (p === '/' || p === '') p = '/index.html';
  if (p.includes('\0')) return null;
  const full = normalize(join(PUBLIC, p));
  if (full !== PUBLIC && !full.startsWith(PUBLIC + sep)) return null;
  return full;
}

async function serveStatic(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: SECURITY_HEADERS });
  }
  const url = new URL(req.url);
  const path = safeStaticPath(url.pathname);
  if (!path) return new Response('Not found', { status: 404 });
  const file = Bun.file(path);
  if (!(await file.exists()) || file.size === 0) {
    return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
  }
  const ext = extname(path).toLowerCase();
  const isAsset = ['.woff2', '.ttf', '.png', '.svg', '.ico'].includes(ext);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': isAsset ? 'public, max-age=604800' : 'no-cache',
    ...SECURITY_HEADERS,
  };
  if (ext === '.js') headers['Service-Worker-Allowed'] = '/';
  return new Response(file, { headers });
}

function sendStatus(ws, payload) {
  try {
    ws.send(JSON.stringify({ type: 'status', ...payload }));
  } catch {}
}

function sendError(ws, message) {
  sendStatus(ws, { state: 'error', message });
}

function closeSocketSafe(ws) {
  try { ws.data.socket?.end(); } catch {}
  ws.data.socket = null;
}

function failConnection(ws, message) {
  if (ws.data.closed) return;
  ws.data.closed = true;
  clearInterval(ws.data.keepalive);
  clearTimeout(ws.data.connectTimer);
  closeSocketSafe(ws);
  sendError(ws, message);
  try { ws.close(1011, 'connection failed'); } catch {}
}

function sendData(ws, data) {
  if (!data || data.length === 0 || ws.data.closed) return;
  try { ws.send(data); } catch { /* socket closed */ }
}

async function connectMud(ws) {
  const { host, port, tls, cols, rows, charset } = ws.data;
  try {
    await assertHostAllowed(host, port);
  } catch (err) {
    failConnection(ws, err.message || 'Connection blocked.');
    return;
  }
  if (ws.data.closed) return;

  const filter = new TelnetFilter({ cols, rows, terminalType: 'XTERM-256COLOR', charset });
  ws.data.filter = filter;

  let settled = false;
  let connectedSocket = null;
  const timer = setTimeout(() => {
    settled = true;
    failConnection(ws, `Timed out connecting to ${host}:${port}.`);
    try { connectedSocket?.end(); } catch {}
  }, CONNECT_TIMEOUT_MS);
  ws.data.connectTimer = timer;

  let socket;
  try {
    socket = await Bun.connect({
      hostname: host,
      port,
      tls: tls ? (isIP(host) ? true : { servername: host }) : undefined,
      socket: {
        data(sock, data) {
          const f = ws.data.filter;
          if (!f || ws.data.closed) return;
          try {
            const result = f.feed(data);
            for (const reply of result.replies) sock.write(reply);
            sendData(ws, result.data);
          } catch (err) {
            failConnection(ws, `Bad data from server: ${err.message || err}`);
          }
        },
        close() {
          if (ws.data.closed) return;
          ws.data.closed = true;
          clearInterval(ws.data.keepalive);
          clearTimeout(ws.data.connectTimer);
          sendStatus(ws, { state: 'closed', message: 'The MUD closed the connection.' });
          try { ws.close(1000, 'mud closed'); } catch {}
        },
        error(_sock, err) {
          failConnection(ws, err?.message || 'Network error.');
        },
        connect_error(_sock, err) {
          failConnection(ws, err?.message || 'Could not connect.');
        },
      },
    });
  } catch (err) {
    clearTimeout(timer);
    ws.data.connectTimer = null;
    if (!settled) failConnection(ws, err.message || `Could not connect to ${host}:${port}.`);
    return;
  }
  connectedSocket = socket;
  if (settled) {
    try { socket.end(); } catch {}
    return;
  }
  clearTimeout(timer);
  ws.data.connectTimer = null;
  if (ws.data.closed) {
    try { socket.end(); } catch {}
    return;
  }
  ws.data.socket = socket;
  ws.data.connected = true;
  sendStatus(ws, { state: 'connected', host, port, tls });
  ws.data.keepalive = setInterval(() => {
    try { ws.ping(); } catch { clearInterval(ws.data.keepalive); }
  }, 30000);
}

export function startServer({ port = Number(process.env.PORT) || 3000, hostname = process.env.HOST || '0.0.0.0' } = {}) {
  const server = Bun.serve({
    port,
    hostname,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === '/healthz') {
        return jsonResponse({ ok: true, name: 'TinTito', ts: Date.now() });
      }
      if (url.pathname === '/ws') {
        const origin = req.headers.get('origin');
        if (origin) {
          let sameOrigin = false;
          try { sameOrigin = new URL(origin).host === req.headers.get('host'); } catch {}
          if (!sameOrigin) return new Response('Forbidden origin', { status: 403 });
        }
        const host = cleanHost(url.searchParams.get('host') || '');
        const portNum = Number(url.searchParams.get('port') || 23);
        const tls = url.searchParams.get('tls') === '1';
        const cols = Math.max(20, Math.min(300, Number(url.searchParams.get('cols') || 80) | 0));
        const rows = Math.max(8, Math.min(200, Number(url.searchParams.get('rows') || 24) | 0));
        const charsetParam = (url.searchParams.get('charset') || 'utf-8').toLowerCase();
        const charset = charsetParam === 'utf-8' ? 'UTF-8' : null;
        if (!host) return new Response('Invalid host', { status: 400 });
        if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
          return new Response('Invalid port', { status: 400 });
        }
        const data = {
          host, port: portNum, tls, cols, rows, charset,
          state: 'connecting', socket: null, filter: null, closed: false,
          connected: false, keepalive: null, connectTimer: null,
        };
        if (srv.upgrade(req, { data })) return undefined;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      return serveStatic(req);
    },
    websocket: {
      maxPayloadLength: 16 * 1024,
      open(ws) {
        ws.data.closed = false;
        sendStatus(ws, { state: 'connecting', host: ws.data.host, port: ws.data.port });
        connectMud(ws).catch((err) => failConnection(ws, err?.message || 'Connection failed.'));
      },
      message(ws, message) {
        if (ws.data.closed) return;
        if (typeof message !== 'string') return;
        let msg;
        try { msg = JSON.parse(message); } catch { return; }
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'input' && typeof msg.data === 'string') {
          const text = msg.data.slice(0, 4096);
          if (!ws.data.socket) return;
          try {
            ws.data.socket.write(encodeInput(text + '\r\n'));
          } catch (err) {
            failConnection(ws, err?.message || 'Write failed.');
          }
        } else if (msg.type === 'raw' && typeof msg.data === 'string') {
          if (!ws.data.socket) return;
          try {
            ws.data.socket.write(encodeInput(msg.data.slice(0, 1024)));
          } catch (err) {
            failConnection(ws, err?.message || 'Write failed.');
          }
        } else if (msg.type === 'resize') {
          const cols = Math.max(20, Math.min(300, Number(msg.cols) | 0));
          const rows = Math.max(8, Math.min(200, Number(msg.rows) | 0));
          ws.data.cols = cols;
          ws.data.rows = rows;
          if (ws.data.filter) {
            for (const r of ws.data.filter.resize(cols, rows)) {
              try { ws.data.socket?.write(r); } catch {}
            }
          }
        } else if (msg.type === 'ping') {
          try { ws.send(JSON.stringify({ type: 'pong', ts: Date.now() })); } catch {}
        }
      },
      close(ws) {
        ws.data.closed = true;
        clearInterval(ws.data.keepalive);
        clearTimeout(ws.data.connectTimer);
        closeSocketSafe(ws);
      },
    },
  });
  return server;
}

if (import.meta.main) {
  const server = startServer();
  console.log(`TinTito is listening on http://${server.hostname}:${server.port}`);
  if (!ALLOW_PRIVATE) {
    console.log('Private/loopback MUD hosts are blocked. Set ALLOW_PRIVATE=1 to allow them.');
  }
}
