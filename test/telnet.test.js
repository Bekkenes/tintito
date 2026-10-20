import { describe, expect, test } from 'bun:test';
import {
  TelnetFilter, encodeInput, IAC, DO, DONT, WILL, WONT, SB, SE, OPT,
} from '../server/telnet.js';

const u8 = (...v) => new Uint8Array(v);
const text = (a) => new TextDecoder('latin1').decode(a);
const has = (arr, seq) => {
  outer: for (const a of arr) {
    if (a.length < seq.length) continue;
    for (let i = 0; i <= a.length - seq.length; i++) {
      for (let j = 0; j < seq.length; j++) if (a[i + j] !== seq[j]) continue outer;
      return true;
    }
  }
  return false;
};

describe('telnet filter', () => {
  test('passes plain data and strips IAC verbs', () => {
    const f = new TelnetFilter();
    const { data, replies } = f.feed(u8(65, IAC, 249, 66, IAC, IAC, 67));
    expect([...data]).toEqual([65, 66, 255, 67]);
    expect(replies).toHaveLength(0);
  });

  test('answers DO NAWS with WILL and a size subnegotiation', () => {
    const f = new TelnetFilter({ cols: 90, rows: 30 });
    const { replies } = f.feed(u8(IAC, DO, OPT.NAWS));
    expect(replies).toHaveLength(2);
    expect([...replies[0]]).toEqual([IAC, WILL, OPT.NAWS]);
    expect(has(replies, u8(IAC, SB, OPT.NAWS, 0, 90, 0, 30, IAC, SE))).toBe(true);
    expect(f.naws).toBe(true);
  });

  test('resize sends a fresh NAWS only after negotiation', () => {
    const f = new TelnetFilter({ cols: 80, rows: 24 });
    expect(f.resize(100, 40)).toEqual([]);
    f.feed(u8(IAC, DO, OPT.NAWS));
    const reps = f.resize(100, 40);
    expect(has(reps, u8(IAC, SB, OPT.NAWS, 0, 100, 0, 40, IAC, SE))).toBe(true);
  });

  test('answers TTYPE SEND', () => {
    const f = new TelnetFilter();
    let r = f.feed(u8(IAC, DO, OPT.TTYPE));
    expect([...r.replies[0]]).toEqual([IAC, WILL, OPT.TTYPE]);
    r = f.feed(u8(IAC, SB, OPT.TTYPE, 1, IAC, SE));
    expect(has(r.replies, u8(IAC, SB, OPT.TTYPE, 0, ...new TextEncoder().encode('XTERM-256COLOR'), IAC, SE))).toBe(true);
  });

  test('WILL ECHO / SGA are accepted', () => {
    const f = new TelnetFilter();
    let r = f.feed(u8(IAC, WILL, OPT.ECHO));
    expect([...r.replies[0]]).toEqual([IAC, DO, OPT.ECHO]);
    r = f.feed(u8(IAC, WILL, OPT.SGA));
    expect([...r.replies[0]]).toEqual([IAC, DO, OPT.SGA]);
  });

  test('unsupported options are refused', () => {
    const f = new TelnetFilter();
    let r = f.feed(u8(IAC, DO, OPT.LINEMODE));
    expect([...r.replies[0]]).toEqual([IAC, WONT, OPT.LINEMODE]);
    r = f.feed(u8(IAC, WILL, OPT.GMCP));
    expect([...r.replies[0]]).toEqual([IAC, DONT, OPT.GMCP]);
    r = f.feed(u8(IAC, DO, OPT.MCCP));
    expect([...r.replies[0]]).toEqual([IAC, WONT, OPT.MCCP]);
  });

  test('charset request chooses UTF-8', () => {
    const f = new TelnetFilter();
    f.feed(u8(IAC, DO, OPT.CHARSET));
    const r = f.feed(u8(IAC, SB, OPT.CHARSET, 1, ...new TextEncoder().encode('UTF-8;ISO-8859-1'), IAC, SE));
    expect(has(r.replies, u8(IAC, SB, OPT.CHARSET, 2, ...new TextEncoder().encode('UTF-8'), IAC, SE))).toBe(true);
  });

  test('WILL CHARSET requests UTF-8', () => {
    const f = new TelnetFilter();
    const r = f.feed(u8(IAC, WILL, OPT.CHARSET));
    expect([...r.replies[0]]).toEqual([IAC, DO, OPT.CHARSET]);
    expect(has(r.replies, u8(IAC, SB, OPT.CHARSET, 1, ...new TextEncoder().encode('UTF-8'), IAC, SE))).toBe(true);
  });

  test('does not re-answer a repeated DO', () => {
    const f = new TelnetFilter();
    f.feed(u8(IAC, DO, OPT.NAWS));
    const r = f.feed(u8(IAC, DO, OPT.NAWS));
    expect(r.replies).toHaveLength(0);
  });

  test('preserves ANSI and UTF-8 bytes in data', () => {
    const f = new TelnetFilter();
    const ansi = new TextEncoder().encode('\x1b[31mTito\x1b[0m');
    const { data } = f.feed(ansi);
    expect(text(data)).toBe('\x1b[31mTito\x1b[0m');
  });

  test('encodes user input as UTF-8', () => {
    const out = encodeInput('a\u00ffb');
    expect([...out]).toEqual([97, 195, 191, 98]); // UTF-8 ff is C3 BF, not a bare IAC
  });
});

describe('charset preference', () => {
  test('a non-UTF-8 client declines charset negotiation', () => {
    const f = new TelnetFilter({ charset: null });
    let r = f.feed(u8(IAC, DO, OPT.CHARSET));
    expect([...r.replies[0]]).toEqual([IAC, WONT, OPT.CHARSET]);
    r = f.feed(u8(IAC, WILL, OPT.CHARSET));
    expect([...r.replies[0]]).toEqual([IAC, DONT, OPT.CHARSET]);
  });
});
