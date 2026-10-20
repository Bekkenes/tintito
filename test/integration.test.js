import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { IAC, DO, WILL, SB, SE, OPT } from '../server/telnet.js';

process.env.ALLOW_PRIVATE = '1';
const { startServer } = await import('../server/server.js');

const enc = new TextEncoder();
const dec = new TextDecoder();

function mockMud() {
  const state = {
    received: [],
    userBytes: new Uint8Array(0),
    subnegs: [],
    sockets: new Set(),
    sawNaws: false,
  };

  function parse(chunk) {
    state.received.push(Uint8Array.from(chunk));
    let buf = state.userBytes;
    const next = new Uint8Array(buf.length + chunk.length);
    next.set(buf);
    next.set(chunk, buf.length);
    state.userBytes = next;
    // crude but sufficient telnet strip for assertion
    const out = [];
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === IAC) {
        i++;
        continue;
      }
      out.push(chunk[i]);
    }
    return out;
  }

  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(socket) {
        state.sockets.add(socket);
        socket.write(new Uint8Array([
          IAC, WILL, OPT.ECHO,
          IAC, WILL, OPT.SGA,
          IAC, DO, OPT.NAWS,
          IAC, DO, OPT.TTYPE,
          IAC, DO, OPT.CHARSET,
        ]));
        setTimeout(() => {
          socket.write(enc.encode(
            '\x1b[2J\x1b[H\x1b[1;33m┌─ TINY TITO TEST MUD ─┐\x1b[0m\r\n' +
            '\x1b[38;5;196mRed\x1b[0m and \x1b[4;36mcyan\x1b[0m.\r\n' +
            '> '
          ));
        }, 80);
      },
      data(socket, chunk) {
        const stripped = parse(chunk);
        // Find NAWS subnegotiation payloads
        const b = Uint8Array.from(chunk);
        for (let i = 0; i < b.length - 4; i++) {
          if (b[i] === IAC && b[i + 1] === SB && b[i + 2] === OPT.NAWS) {
            state.sawNaws = true;
            state.subnegs.push([b[i + 3], b[i + 4], b[i + 5], b[i + 6]]);
          }
        }
        // Echo any printable user bytes as a prompt line.
        const printable = [...stripped].filter((c) => c === 13 || c === 10 || (c >= 32 && c < 127));
        if (printable.length) {
          const line = String.fromCharCode(...printable).replace(/\r/g, '').replace(/\n/g, '');
          if (line) socket.write(enc.encode(`\r\n[echo] ${line}\r\n> `));
        }
      },
      close(socket) {
        state.sockets.delete(socket);
      },
      error() {},
    },
  });
  return { server, state, port: server.port };
}

function waitForMessage(ws, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for ws message')), timeout);
    const onMessage = (event) => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      resolve(event);
    };
    ws.addEventListener('message', onMessage);
  });
}

function waitForStatus(ws, wanted, timeout = 4000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      if (typeof event.data !== 'string') return;
      const msg = JSON.parse(event.data);
      if (msg.type === 'status' && msg.state === wanted) {
        ws.removeEventListener('message', onMessage);
        resolve(msg);
      } else if (Date.now() - start > timeout) {
        ws.removeEventListener('message', onMessage);
        reject(new Error(`no ${wanted} status`));
      }
    };
    ws.addEventListener('message', onMessage);
  });
}

let app;
let mock;
let ws;
let binary = new Uint8Array(0);

beforeAll(async () => {
  mock = mockMud();
  app = startServer({ port: 0, hostname: '127.0.0.1' });
  const url = `ws://127.0.0.1:${app.port}/ws?host=127.0.0.1&port=${mock.port}&cols=80&rows=24`;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket failed')), { once: true });
  });
  ws.addEventListener('message', (event) => {
    if (typeof event.data === 'string') return;
    const chunk = new Uint8Array(event.data);
    const next = new Uint8Array(binary.length + chunk.length);
    next.set(binary);
    next.set(chunk, binary.length);
    binary = next;
  });
  await waitForStatus(ws, 'connected');
  await new Promise((r) => setTimeout(r, 220));
});

afterAll(() => {
  try { ws?.close(); } catch {}
  try { app?.stop(true); } catch {}
  try { mock?.server.stop(true); } catch {}
});

describe('bridge integration', () => {
  test('negotiates NAWS and receives ANSI output untouched', () => {
    expect(mock.state.sawNaws).toBe(true);
    expect(mock.state.subnegs[0]).toEqual([0, 80, 0, 24]);
    const text = dec.decode(binary);
    expect(text).toContain('┌─ TINY TITO TEST MUD ─┐');
    expect(text).toContain('\x1b[38;5;196mRed\x1b[0m');
  });

  test('relays user input to the MUD and back', async () => {
    ws.send(JSON.stringify({ type: 'input', data: 'look' }));
    await new Promise((r) => setTimeout(r, 120));
    const sent = dec.decode(mock.state.userBytes);
    expect(sent).toContain('look\r\n');
    const text = dec.decode(binary);
    expect(text).toContain('[echo] look');
  });

  test('resize sends a NAWS update', async () => {
    ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
    await new Promise((r) => setTimeout(r, 120));
    expect(mock.state.subnegs.some((n) => n[0] === 0 && n[1] === 100 && n[2] === 0 && n[3] === 30)).toBe(true);
  });
});

describe('http surface', () => {
  test('serves the app shell and health endpoint', async () => {
    const base = `http://127.0.0.1:${app.port}`;
    const home = await fetch(base + '/');
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('TinTito');
    const health = await fetch(base + '/healthz');
    expect(health.status).toBe(200);
    expect((await health.json()).ok).toBe(true);
  });

  test('does not traverse outside public/', async () => {
    const res = await fetch(`http://127.0.0.1:${app.port}/../server/server.js`);
    expect(res.status).toBe(404);
  });
});
