import { describe, expect, test } from 'bun:test';
import {
  Terminal, cellsToRuns, CP437, BOLD, UNDERLINE, INVERSE,
} from '../public/terminal.js';

function lineText(t, y) {
  return cellsToRuns(t.lines[y].cells).map((r) => r.text).join('');
}
function allText(t) {
  return [...t.scrollback.map((l) => cellsToRuns(l.cells).map((r) => r.text).join('')), ...t.lines.map((_, y) => lineText(t, y))].join('\n').replace(/ +$/gm, '');
}

describe('terminal basics', () => {
  test('writes text and advances the cursor', () => {
    const t = new Terminal({ cols: 10, rows: 4 });
    t.feed('hello');
    expect(lineText(t, 0)).toBe('hello');
    expect(t.x).toBe(5);
    expect(t.y).toBe(0);
  });

  test('autowraps long lines', () => {
    const t = new Terminal({ cols: 5, rows: 4 });
    t.feed('abcdefg');
    expect(lineText(t, 0)).toBe('abcde');
    expect(lineText(t, 1)).toBe('fg');
    expect(t.x).toBe(2);
  });

  test('CR rewrites the current line', () => {
    const t = new Terminal({ cols: 10, rows: 3 });
    t.feed('abc\rXY');
    expect(lineText(t, 0)).toBe('XYc');
    expect(t.x).toBe(2);
  });

  test('backspace and tab', () => {
    const t = new Terminal({ cols: 20, rows: 3 });
    t.feed('ab\bc\tX');
    expect(lineText(t, 0)).toBe('ac      X');
  });

  test('cursor addressing writes at coordinates', () => {
    const t = new Terminal({ cols: 10, rows: 4 });
    t.feed('\x1b[2;3H!');
    expect(lineText(t, 1)).toBe('  !');
    expect(t.x).toBe(3);
    expect(t.y).toBe(1);
  });

  test('erase line and display', () => {
    const t = new Terminal({ cols: 6, rows: 3 });
    t.feed('abcdef\x1b[3G\x1b[K');
    expect(lineText(t, 0)).toBe('ab');
    t.feed('\x1b[2J');
    expect(lineText(t, 0)).toBe('');
    expect(lineText(t, 1)).toBe('');
  });

  test('scrolling feeds the scrollback', () => {
    const t = new Terminal({ cols: 10, rows: 2 });
    t.feed('a\r\nb\r\nc');
    expect(t.scrollback.map((l) => cellsToRuns(l.cells).map((r) => r.text).join(''))).toEqual(['a']);
    expect(lineText(t, 0)).toBe('b');
    expect(lineText(t, 1)).toBe('c');
  });

  test('scroll region confines scrolling', () => {
    const t = new Terminal({ cols: 10, rows: 5 });
    t.feed('0\r\n1\r\n2\r\n3\r\n4');
    t.feed('\x1b[2;4r\x1b[4;1H\nX');
    expect(lineText(t, 0)).toBe('0');
    expect(lineText(t, 4)).toBe('4');
    expect(lineText(t, 1)).toBe('2');
    expect(lineText(t, 3)).toBe('X');
  });

  test('alt screen restores the normal screen', () => {
    const t = new Terminal({ cols: 10, rows: 3 });
    t.feed('normal');
    t.feed('\x1b[?1049h');
    expect(t.alt).toBe(true);
    t.feed('ALT');
    expect(lineText(t, 0)).toBe('ALT');
    t.feed('\x1b[?1049l');
    expect(t.alt).toBe(false);
    expect(lineText(t, 0)).toBe('normal');
  });
});

describe('SGR', () => {
  test('basic colours and flags', () => {
    const t = new Terminal({ cols: 10, rows: 2 });
    t.feed('\x1b[1;31mA\x1b[0mB');
    const a = t.lines[0].cells[0];
    const b = t.lines[0].cells[1];
    expect(a.style.fg).toBe(1);
    expect(a.style.flags & BOLD).toBeTruthy();
    expect(b.style.fg).toBeNull();
  });

  test('256 colour and truecolour', () => {
    const t = new Terminal({ cols: 10, rows: 2 });
    t.feed('\x1b[38;5;196mA\x1b[48;2;1;2;3mB');
    expect(t.lines[0].cells[0].style.fg).toBe('#ff0000');
    expect(t.lines[0].cells[1].style.bg).toBe('#010203');
  });

  test('inverse and underline survive adjacent text', () => {
    const t = new Terminal({ cols: 10, rows: 2 });
    t.feed('\x1b[7;4mZ');
    const s = t.lines[0].cells[0].style;
    expect(s.flags & INVERSE).toBeTruthy();
    expect(s.flags & UNDERLINE).toBeTruthy();
  });

  test('colon-form truecolour', () => {
    const t = new Terminal({ cols: 10, rows: 2 });
    t.feed('\x1b[38:2::12:34:56mX');
    expect(t.lines[0].cells[0].style.fg).toBe('#0c2238');
  });
});

describe('fidelity', () => {
  test('DEC special graphics maps box drawing', () => {
    const t = new Terminal({ cols: 10, rows: 2 });
    t.feed('\x1b(0lqk\x1b(B');
    expect(lineText(t, 0)).toBe('┌─┐');
  });

  test('combining marks append to the previous cell', () => {
    const t = new Terminal({ cols: 10, rows: 2 });
    t.feed('e\u0301X');
    expect(t.lines[0].cells[0].ch).toBe('e\u0301');
    expect(t.lines[0].cells[1].ch).toBe('X');
    expect(t.x).toBe(2);
  });

  test('wide characters occupy two cells', () => {
    const t = new Terminal({ cols: 10, rows: 2 });
    t.feed('你a');
    expect(t.lines[0].cells[0].ch).toBe('你');
    expect(t.lines[0].cells[1].cont).toBe(true);
    expect(t.lines[0].cells[2].ch).toBe('a');
    expect(t.x).toBe(3);
  });

  test('OSC title and hyperlink do not leak into text', () => {
    const t = new Terminal({ cols: 20, rows: 2 });
    let title = '';
    t.onTitle = (v) => { title = v; };
    t.feed('\x1b]0;Aardwolf\x07Hi');
    expect(title).toBe('Aardwolf');
    expect(lineText(t, 0)).toBe('Hi');
    t.feed('\x1b]8;;https://example.com\x07Link\x1b]8;;\x07');
    expect(lineText(t, 0)).toBe('HiLink');
    expect(t.lines[0].cells[2].style.link).toBe('https://example.com');
    expect(t.lines[0].cells[6].style.link).toBeNull();
  });

  test('CP437 table covers all bytes', () => {
    expect(CP437).toHaveLength(256);
    expect(CP437[0xdb]).toBe('█');
    expect(CP437[0xc4]).toBe('─');
  });

  test('reflow on resize joins soft-wrapped lines', () => {
    const t = new Terminal({ cols: 10, rows: 6 });
    t.feed('abcdefghijK');
    expect(t.lines[0].wrapped).toBe(true);
    t.resize(20, 6);
    expect(allText(t)).toContain('abcdefghijK');
  });

  test('reflow preserves colour runs', () => {
    const t = new Terminal({ cols: 6, rows: 6 });
    t.feed('\x1b[31mabc\x1b[0mdef');
    t.resize(12, 6);
    const chars = [];
    for (let y = 0; y < t.rows; y++) {
      for (const c of t.lines[y].cells) {
        if (c.ch === ' ') break;
        chars.push([c.ch, c.style.fg]);
      }
    }
    expect(chars).toEqual([['a', 1], ['b', 1], ['c', 1], ['d', null], ['e', null], ['f', null]]);
  });
});

describe('scrollback cap', () => {
  test('keeps a monotonic total when old lines are dropped', () => {
    const t = new Terminal({ cols: 10, rows: 2, scrollback: 3 });
    t.feed('a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng');
    expect(t.scrollback.length).toBe(3);
    expect(t.scrollbackTotal).toBe(5);
    const lines = t.scrollback.map((l) => cellsToRuns(l.cells).map((r) => r.text).join(''));
    expect(lines).toEqual(['c', 'd', 'e']);
  });
});
