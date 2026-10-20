#!/usr/bin/env bun
/* A tiny demo MUD for TinTito. Not a real game; a high-colour test target. */
import { readFileSync } from 'node:fs';
import { IAC, DONT, DO, WONT, WILL, SB, SE, OPT } from '../server/telnet.js';

const grid = JSON.parse(readFileSync(new URL('../assets/mascot-grid.json', import.meta.url)));
const PORT = Number(process.env.DEMO_PORT) || 7777;
const HOST = process.env.DEMO_HOST || '127.0.0.1';
const GOLD = '\x1b[38;2;232;180;90m';
const STEEL = '\x1b[38;2;143;176;201m';
const GREEN = '\x1b[38;5;114m';
const DIM = '\x1b[38;5;245m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const enc = new TextEncoder();

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const vlen = (s) => strip(s).length;

function center(s, width) {
  const pad = Math.max(0, Math.floor((width - vlen(s)) / 2));
  return ' '.repeat(pad) + s;
}

function wrap(text, width) {
  const words = text.split(/\s+/);
  const out = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w;
    else if (vlen(line) + 1 + vlen(w) <= width) line += ' ' + w;
    else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}

function hexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function mascotLines(cols) {
  const scale = cols >= 44 ? 1 : 2;
  const sampleW = Math.ceil(40 / scale);
  const sampleH = Math.ceil(40 / scale);
  const rows = [];
  for (let y = 0; y < sampleH; y += 2) {
    let line = '';
    for (let x = 0; x < sampleW; x++) {
      const top = grid[Math.min(39, y * scale)]?.[Math.min(39, x * scale)];
      const bottom = grid[Math.min(39, (y + 1) * scale)]?.[Math.min(39, x * scale)];
      if (!top && !bottom) { line += '\x1b[49m '; continue; }
      if (top && bottom) {
        const tc = hexRgb(top), bc = hexRgb(bottom);
        line += `\x1b[38;2;${tc[0]};${tc[1]};${tc[2]}m\x1b[48;2;${bc[0]};${bc[1]};${bc[2]}m▀`;
      } else if (top) {
        const tc = hexRgb(top);
        line += `\x1b[49m\x1b[38;2;${tc[0]};${tc[1]};${tc[2]}m▀`;
      } else {
        const bc = hexRgb(bottom);
        line += `\x1b[49m\x1b[38;2;${bc[0]};${bc[1]};${bc[2]}m▄`;
      }
    }
    rows.push(line + RESET);
  }
  const width = Math.max(...rows.map((r) => vlen(r)));
  return rows.map((r) => center(r, Math.min(cols, 78)));
}

function box(lines, cols, title = '') {
  const width = Math.max(20, Math.min(cols - 2, 70));
  const inner = width - 4;
  const out = [];
  const topTitle = title ? `─ ${title} ` : '─';
  out.push(`${GOLD}╭${topTitle}${'─'.repeat(Math.max(0, width - 2 - topTitle.length))}╮${RESET}`);
  for (const l of lines) {
    for (const w of wrap(l, inner)) {
      out.push(`${GOLD}│${RESET} ${w}${' '.repeat(Math.max(0, inner - vlen(w)))} ${GOLD}│${RESET}`);
    }
  }
  out.push(`${GOLD}╰${'─'.repeat(width - 2)}╯${RESET}`);
  return out;
}

function banner(cols) {
  const width = Math.min(cols, 78);
  const art = mascotLines(cols);
  const out = ['', ...art, ''];
  out.push(center(`${GOLD}${BOLD}TINY TITO'S KENNEL${RESET}`, width));
  out.push(center(`${DIM}a pocket-sized demo world${RESET}`, width));
  out.push('');
  out.push(...box([
    `A Yorkie knight dozes by the gate, sword across his paws. The courtyard is ${GREEN}warm${RESET} and suspiciously tidy.`,
    `This is the TinTito demo, not a real MUD. Type ${GOLD}help${RESET} for things to try.`,
  ], cols, 'The gate'));
  out.push('');
  return out.join('\r\n');
}

const HELP = [
  `${GOLD}look${RESET}      survey the courtyard`,
  `${GOLD}pet tito${RESET}  scratch the smallest knight`,
  `${GOLD}north${RESET}     head through the gate`,
  `${GOLD}who${RESET}       see who is about`,
  `${GOLD}colors${RESET}    show off the terminal's palette`,
  `${GOLD}clear${RESET}     wipe the screen`,
  `${GOLD}quit${RESET}      leave the kennel`,
];

function prompt() {
  return `\r\n${GOLD}>${RESET} `;
}

function handleCommand(cmd, socket, state) {
  const c = cmd.trim().toLowerCase().replace(/[^\x20-\x7e]/g, '');
  socket.write(enc.encode(`\r\n${DIM}>${RESET} ${c}`));
  if (!c) { socket.write(enc.encode(prompt())); return; }
  if (c === 'help' || c === '?') {
    socket.write(enc.encode('\r\n' + box(HELP, state.cols, 'Useful things').join('\r\n') + prompt()));
  } else if (c === 'look' || c === 'l') {
    const map = [
      `${STEEL}        ╔══════════════╗${RESET}`,
      `${STEEL}        ║  ⌂  kennel   ║${RESET}`,
      `${STEEL}        ║   ·  Tito    ║${RESET}`,
      `${STEEL}        ╚══════╦═══════╝${RESET}`,
      `${STEEL}               ║${RESET}`,
      `${STEEL}        ╭──────╩──────╮${RESET}`,
      `${STEEL}        │  courtyard  │${RESET}`,
      `${STEEL}        ╰─────────────╯${RESET}`,
    ];
    socket.write(enc.encode('\r\n' + box([
      `Sunlight pools on the flagstones. A wooden training dummy leans at a careless angle.`,
      `Tito is here, wearing his helmet indoors, as one does.`,
    ], state.cols, 'Kennel courtyard').join('\r\n') + '\r\n' + map.join('\r\n') + prompt()));
  } else if (c === 'pet tito' || c === 'pet') {
    socket.write(enc.encode(`\r\nTito's tail becomes a small helicopter. He pretends not to notice.\r\n${DIM}A tiny, dignified "woof".${RESET}${prompt()}`));
  } else if (c === 'north' || c === 'n') {
    socket.write(enc.encode(`\r\nYou push through the gate. Beyond it, the road is still being written.\r\n${DIM}(This is where a real MUD would have 30,000 rooms.)${RESET}${prompt()}`));
  } else if (c === 'who') {
    socket.write(enc.encode(`\r\n${GOLD}Adventurers:${RESET} 1 (you)\r\n${GOLD}Yorkies:${RESET} 1 (Tito, knight-errant)\r\n${GOLD}Dust bunnies:${RESET} an estimated 14${prompt()}`));
  } else if (c === 'colors' || c === 'colour' || c === 'color') {
    let out = '\r\n';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 16; col++) {
        const n = row * 16 + col;
        out += `\x1b[48;5;${n}m  `;
      }
      out += RESET + '\r\n';
    }
    out += `\r\n${DIM}256 colours, plus truecolor for the mascot above.${RESET}`;
    socket.write(enc.encode(out + prompt()));
  } else if (c === 'clear') {
    socket.write(enc.encode('\x1b[2J\x1b[H' + prompt()));
  } else if (c === 'quit' || c === 'exit') {
    socket.write(enc.encode(`\r\nThe gate clicks shut. Tito salutes with the sword.\r\n`));
    setTimeout(() => { try { socket.end(); } catch {} }, 120);
  } else {
    socket.write(enc.encode(`\r\nTito tilts his head. Try ${GOLD}help${RESET}.${prompt()}`));
  }
}

function attach(socket) {
  const state = { cols: 80, rows: 24, line: [], iac: false, skipOpt: false, sb: false, sbOpt: 0, sbBuf: [], lastCR: false };
  const send = (text) => { try { socket.write(enc.encode(text)); } catch {} };
  const sendBytes = (bytes) => { try { socket.write(new Uint8Array(bytes)); } catch {} };

  sendBytes([
    IAC, WILL, OPT.ECHO,
    IAC, WILL, OPT.SGA,
    IAC, DO, OPT.NAWS,
    IAC, DO, OPT.TTYPE,
    IAC, DO, OPT.CHARSET,
  ]);

  setTimeout(() => {
    sendBytes([IAC, SB, OPT.TTYPE, 1, IAC, SE]);
    sendBytes([IAC, SB, OPT.CHARSET, 1, ...enc.encode('UTF-8'), IAC, SE]);
    send('\x1b[2J\x1b[H' + banner(state.cols) + prompt());
  }, 160);

  return (chunk) => {
    for (const b of chunk) {
      if (state.skipOpt) { state.skipOpt = false; continue; }
      if (state.iac) {
        state.iac = false;
        if (b === IAC) {
          if (state.sb) state.sbBuf.push(255);
          else state.line.push(255);
        } else if (b === SB) {
          state.sb = true;
          state.sbOpt = 0;
          state.sbBuf = [];
        } else if (b === SE) {
          if (state.sb) {
            state.sb = false;
            if (state.sbOpt === OPT.NAWS && state.sbBuf.length >= 4) {
              state.cols = (state.sbBuf[0] << 8) | state.sbBuf[1];
              state.rows = (state.sbBuf[2] << 8) | state.sbBuf[3];
              console.log(`NAWS ${state.cols}x${state.rows}`);
            }
            state.sbBuf = [];
          }
        } else if (b === WILL || b === WONT || b === DO || b === DONT) {
          state.skipOpt = true;
        }
        continue;
      }
      if (b === IAC) { state.iac = true; continue; }
      if (state.sb) {
        if (state.sbOpt === 0) state.sbOpt = b;
        else state.sbBuf.push(b);
        continue;
      }
      if (b === 13 || b === 10) {
        if (b === 10 && state.lastCR) { state.lastCR = false; continue; }
        state.lastCR = b === 13;
        const text = state.line.length ? new TextDecoder('utf-8').decode(Uint8Array.from(state.line)) : '';
        state.line = [];
        handleCommand(text, socket, state);
        continue;
      }
      state.lastCR = false;
      if (b === 8 || b === 127) { state.line.pop(); continue; }
      if (b >= 32) state.line.push(b);
      if (state.line.length > 1200) state.line.shift();
    }
  };
}

const server = Bun.listen({
  hostname: HOST,
  port: PORT,
  socket: {
    open(socket) {
      socket.data = attach(socket);
    },
    data(socket, chunk) {
      socket.data?.(chunk);
    },
    close() {},
    error() {},
  },
});

console.log(`TinTito demo MUD on ${HOST}:${server.port}`);
console.log(`Start the client with: ALLOW_PRIVATE=1 bun run start, then connect to ${HOST}:${server.port}`);
