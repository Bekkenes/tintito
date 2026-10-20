/* Minimal TELNET client-side filter.
 * Strips IAC verbs from the server stream and answers the options a MUD
 * actually cares about: NAWS, TTYPE, CHARSET, ECHO, SGA, BINARY.
 */

export const IAC = 255;
export const DONT = 254;
export const DO = 253;
export const WONT = 252;
export const WILL = 251;
export const SB = 250;
export const SE = 240;

export const OPT = {
  BINARY: 0,
  ECHO: 1,
  SGA: 3,
  STATUS: 5,
  TTYPE: 24,
  EOR: 25,
  NAWS: 31,
  LINEMODE: 34,
  NEW_ENVIRON: 39,
  CHARSET: 42,
  MSSP: 70,
  MSDP: 69,
  MCCP: 86,
  MCCP2: 86,
  MSP: 90,
  MXP: 91,
  GMCP: 201,
  ATCP: 200,
  AARDWOLF: 102,
};

const TTYPE_IS = 0;
const TTYPE_SEND = 1;
const CHARSET_REQUEST = 1;
const CHARSET_ACCEPTED = 2;
const CHARSET_REJECTED = 3;

function bytes(...values) {
  return new Uint8Array(values);
}

function subneg(option, payload) {
  const out = new Uint8Array(payload.length + 5);
  out[0] = IAC; out[1] = SB; out[2] = option;
  out.set(payload, 3);
  out[out.length - 2] = IAC;
  out[out.length - 1] = SE;
  return out;
}

function asciiPayload(text) {
  const clean = String(text).replace(/[^\x20-\x7e]/g, '?');
  return Uint8Array.from([...clean].map((c) => c.charCodeAt(0)));
}

export class TelnetFilter {
  constructor({ cols = 80, rows = 24, terminalType = 'XTERM-256COLOR', charset = 'UTF-8' } = {}) {
    this.setSize(cols, rows);
    this.terminalType = String(terminalType || 'XTERM-256COLOR').slice(0, 40);
    this.charsetEnabled = charset !== null && charset !== undefined;
    this.state = 'data';
    this.cmd = 0;
    this.opt = 0;
    this.sb = [];
    this.local = new Map();
    this.remote = new Map();
    this.naws = false;
    this.ttype = false;
    this.charsetAgreed = false;
    this.out = new Uint8Array(0);
    this.outLen = 0;
    this.replies = [];
  }

  setSize(cols, rows) {
    this.cols = Math.max(2, Math.min(65535, cols | 0));
    this.rows = Math.max(2, Math.min(65535, rows | 0));
  }

  resize(cols, rows) {
    this.setSize(cols, rows);
    return this.naws ? [this.nawsSubneg()] : [];
  }

  feed(bytesIn) {
    this.replies = [];
    this.out = new Uint8Array(bytesIn.length);
    this.outLen = 0;
    for (let i = 0; i < bytesIn.length; i++) this.byte(bytesIn[i]);
    const data = this.outLen === this.out.length ? this.out : this.out.slice(0, this.outLen);
    return { data, replies: this.replies };
  }

  push(b) {
    this.out[this.outLen++] = b;
  }

  reply(cmd, opt) {
    this.replies.push(bytes(IAC, cmd, opt));
  }

  byte(b) {
    switch (this.state) {
      case 'data':
        if (b === IAC) this.state = 'iac';
        else this.push(b);
        break;
      case 'iac':
        if (b === IAC) { this.push(255); this.state = 'data'; }
        else if (b === DO || b === DONT || b === WILL || b === WONT) {
          this.cmd = b; this.state = 'opt';
        } else if (b === SB) { this.state = 'sb'; this.sb = []; }
        else this.state = 'data'; // GA, NOP, DM, ...
        break;
      case 'opt':
        this.negotiate(this.cmd, b);
        this.state = 'data';
        break;
      case 'sb':
        if (b === IAC) this.state = 'sbIac';
        else if (this.sb.length < 8192) this.sb.push(b);
        break;
      case 'sbIac':
        if (b === SE) { this.subnegotiate(Uint8Array.from(this.sb)); this.sb = []; this.state = 'data'; }
        else if (b === IAC) { this.sb.push(255); this.state = 'sb'; }
        else this.state = 'sb';
        break;
      default:
        this.state = 'data';
    }
  }

  negotiate(cmd, opt) {
    if (cmd === DO) {
      if (this.local.get(opt)) return;
      const allowed = opt === OPT.NAWS || opt === OPT.TTYPE || opt === OPT.SGA ||
        (opt === OPT.CHARSET && this.charsetEnabled);
      if (!allowed) { this.reply(WONT, opt); return; }
      this.local.set(opt, true);
      this.reply(WILL, opt);
      if (opt === OPT.NAWS) {
        this.naws = true;
        this.replies.push(this.nawsSubneg());
      } else if (opt === OPT.CHARSET) {
        this.charsetAgreed = true;
      }
    } else if (cmd === WILL) {
      if (this.remote.get(opt)) return;
      const allowed = opt === OPT.ECHO || opt === OPT.SGA ||
        (opt === OPT.CHARSET && this.charsetEnabled);
      if (!allowed) { this.reply(DONT, opt); return; }
      this.remote.set(opt, true);
      this.reply(DO, opt);
      if (opt === OPT.CHARSET) {
        this.charsetAgreed = true;
        // RFC 2066: the client asks for its preferred encoding.
        this.replies.push(subneg(OPT.CHARSET, Uint8Array.from([CHARSET_REQUEST, ...asciiPayload('UTF-8')])));
      }
    } else if (cmd === WONT) {
      this.remote.set(opt, false);
    } else if (cmd === DONT) {
      this.local.set(opt, false);
      if (opt === OPT.NAWS) this.naws = false;
    }
  }

  subnegotiate(payload) {
    if (payload.length < 1) return;
    // The option byte is the first byte of the subnegotiation payload.
    if (payload.length < 2) return;
    const option = payload[0];
    const body = payload.slice(1);
    if (option === OPT.NAWS) {
      // Servers do not send NAWS; ignore.
      return;
    }
    if (option === OPT.TTYPE) {
      if (body[0] === TTYPE_SEND) {
        const name = asciiPayload(this.terminalType);
        this.replies.push(subneg(OPT.TTYPE, Uint8Array.from([TTYPE_IS, ...name])));
      }
      return;
    }
    if (option === OPT.CHARSET && this.charsetEnabled) {
      const sub = body[0];
      if (sub === CHARSET_REQUEST) {
        const offered = new TextDecoder('latin1').decode(body.slice(1)).split(/[;\0 ]+/).filter(Boolean);
        const hasUtf8 = offered.some((x) => /^utf-?8$/i.test(x));
        if (hasUtf8) {
          this.encoding = 'UTF-8';
          this.replies.push(subneg(OPT.CHARSET, Uint8Array.from([CHARSET_ACCEPTED, ...asciiPayload('UTF-8')])));
        } else {
          this.replies.push(subneg(OPT.CHARSET, Uint8Array.from([CHARSET_REJECTED, ...asciiPayload('UTF-8')])));
        }
      }
      return;
    }
  }

  nawsSubneg() {
    const w = this.cols, h = this.rows;
    return subneg(OPT.NAWS, Uint8Array.from([(w >> 8) & 255, w & 255, (h >> 8) & 255, h & 255]));
  }
}

export function encodeInput(text) {
  const raw = new TextEncoder().encode(text);
  // Escape IAC bytes (0xFF) as required by RFC 854.
  let extra = 0;
  for (const b of raw) if (b === 255) extra++;
  if (!extra) return raw;
  const out = new Uint8Array(raw.length + extra);
  let j = 0;
  for (const b of raw) {
    out[j++] = b;
    if (b === 255) out[j++] = 255;
  }
  return out;
}
