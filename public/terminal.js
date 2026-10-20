/* TinTito terminal: a small ANSI/VT screen model.
 * Pure JS, no DOM. Feed it decoded text; it maintains a grid + scrollback.
 */

export const BOLD = 1;
export const DIM = 2;
export const ITALIC = 4;
export const UNDERLINE = 8;
export const BLINK = 16;
export const INVERSE = 32;
export const HIDDEN = 64;
export const STRIKE = 128;

const DEFAULT_STYLE = Object.freeze({ fg: null, bg: null, flags: 0, link: null });
export { DEFAULT_STYLE };

const styleCache = new Map();
function internStyle(fg, bg, flags, link) {
  const key = `${fg ?? ''}|${bg ?? ''}|${flags}|${link ?? ''}`;
  let s = styleCache.get(key);
  if (!s) {
    if (styleCache.size > 8192) styleCache.clear();
    s = Object.freeze({ fg, bg, flags, link });
    styleCache.set(key, s);
  }
  return s;
}

const BLANK = Object.freeze({ ch: ' ', style: DEFAULT_STYLE });
const WIDE_BLANK = Object.freeze({ ch: '', style: DEFAULT_STYLE, cont: true });

function blankCell(style = DEFAULT_STYLE) {
  if (style === DEFAULT_STYLE) return BLANK;
  return { ch: ' ', style };
}
function blankRow(cols, style = DEFAULT_STYLE) {
  return Array(cols).fill(blankCell(style));
}

const COMBINING = /\p{M}/u;
function charWidth(cp) {
  if (cp === 0) return 0;
  if (cp < 32) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 || cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f000 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) return 2;
  return 1;
}

const DEC_SPECIAL = {
  '`': '◆', a: '▒', b: '␉', c: '␌', d: '␍', e: '␊', f: '°', g: '±', h: '␤',
  i: '␋', j: '┘', k: '┐', l: '┌', m: '└', n: '┼', o: '⎺', p: '⎻', q: '─',
  r: '⎼', s: '⎽', t: '├', u: '┤', v: '┴', w: '┬', x: '│', y: '≤', z: '≥',
  '{': 'π', '|': '≠', '}': '£', '~': '·',
};

function cloneLine(line) {
  return { cells: line.cells.slice(), wrapped: line.wrapped };
}

export class Terminal {
  constructor({ cols = 80, rows = 24, scrollback = 2000 } = {}) {
    this.scrollbackLimit = scrollback;
    this.alt = false;
    this.altSaved = null;
    this.scrollback = [];
    this.scrollbackTotal = 0;
    this.title = '';
    this.bellCount = 0;
    this.onBell = null;
    this.onTitle = null;
    this.onResponse = null;
    this.dirty = new Set();
    this.layoutVersion = 0;
    this.reset(cols, rows);
  }

  reset(cols = this.cols || 80, rows = this.rows || 24) {
    this.cols = Math.max(2, cols | 0);
    this.rows = Math.max(2, rows | 0);
    this.lines = Array.from({ length: this.rows }, () => ({ cells: blankRow(this.cols), wrapped: false }));
    this.x = 0;
    this.y = 0;
    this.pendingWrap = false;
    this.autoWrap = true;
    this.cursorVisible = true;
    this.insertMode = false;
    this.originMode = false;
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.pen = DEFAULT_STYLE;
    this.link = null;
    this.g = ['ascii', 'ascii'];
    this.gl = 0;
    this.savedCursor = null;
    this.tabStops = new Set();
    for (let i = 8; i < this.cols; i += 8) this.tabStops.add(i);
    this.parseState = 'data';
    this.csi = '';
    this.osc = '';
    this.charsetTarget = 0;
    this.title = '';
    this.dirty.clear();
    for (let y = 0; y < this.rows; y++) this.dirty.add(y);
    this.layoutVersion++;
  }

  // ---------- public ----------

  feed(input) {
    if (typeof input !== 'string' || input.length === 0) return;
    for (const ch of input) {
      const cp = ch.codePointAt(0);
      if (this.parseState === 'data') {
        if (cp === 0x1b) { this.parseState = 'esc'; continue; }
        if (cp < 0x20 || cp === 0x7f) { this.control(cp); continue; }
        this.printChar(ch, cp);
      } else {
        this.parse(ch, cp);
      }
    }
  }

  resize(cols, rows) {
    cols = Math.max(2, cols | 0);
    rows = Math.max(2, rows | 0);
    if (cols === this.cols && rows === this.rows) return;
    if (this.alt) {
      const old = this.lines;
      const next = Array.from({ length: rows }, (_, y) => {
        const cells = blankRow(cols);
        const src = old[y];
        if (src) {
          for (let x = 0; x < Math.min(cols, this.cols); x++) cells[x] = src.cells[x];
        }
        return { cells, wrapped: src ? src.wrapped : false };
      });
      this.lines = next;
      this.cols = cols;
      this.rows = rows;
      this.x = Math.min(this.x, cols - 1);
      this.y = Math.min(this.y, rows - 1);
      this.scrollTop = 0;
      this.scrollBottom = rows - 1;
      this.pendingWrap = false;
      this.dirty.clear();
      for (let y = 0; y < rows; y++) this.dirty.add(y);
      this.layoutVersion++;
      return;
    }

    // Build one logical stream from scrollback + the used portion of the screen.
    let lastUsed = -1;
    for (let y = this.rows - 1; y >= 0; y--) {
      if (!this.isBlankLine(this.lines[y])) { lastUsed = y; break; }
    }
    lastUsed = Math.max(lastUsed, Math.min(this.y, this.rows - 1));
    const source = [...this.scrollback, ...this.lines.slice(0, lastUsed + 1)];

    const groups = [];
    let cur = null;
    for (const line of source) {
      if (!cur) cur = { cells: [], wrapped: false };
      cur.cells.push(...line.cells);
      cur.wrapped = line.wrapped;
      if (!line.wrapped) { groups.push(cur); cur = null; }
    }
    if (cur) groups.push(cur);

    const wrappedLines = [];
    for (const g of groups) {
      let cells = g.cells;
      // drop only trailing default blanks; keeps spaces used for layout/colour
      let end = cells.length;
      while (end > 0) {
        const cell = cells[end - 1];
        if (!cell.cont && cell.ch === ' ' && cell.style === DEFAULT_STYLE) end--;
        else break;
      }
      cells = cells.slice(0, end);
      if (cells.length === 0) {
        wrappedLines.push({ cells: blankRow(cols), wrapped: false });
        continue;
      }
      for (let i = 0; i < cells.length; i += cols) {
        const chunk = blankRow(cols);
        const slice = cells.slice(i, i + cols);
        for (let k = 0; k < slice.length; k++) chunk[k] = slice[k];
        const isLast = i + cols >= cells.length;
        wrappedLines.push({ cells: chunk, wrapped: !isLast || (g.wrapped && false) });
      }
    }

    let screen, cursorY;
    if (wrappedLines.length >= rows) {
      screen = wrappedLines.slice(-rows);
      cursorY = rows - 1;
    } else {
      screen = wrappedLines.slice();
      cursorY = Math.max(0, screen.length - 1);
      while (screen.length < rows) screen.push({ cells: blankRow(cols), wrapped: false });
    }
    this.scrollback = wrappedLines.slice(0, Math.max(0, wrappedLines.length - screen.length)).slice(-this.scrollbackLimit);
    this.scrollbackTotal = this.scrollback.length;
    this.lines = screen;
    this.cols = cols;
    this.rows = rows;
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
    // Put the cursor at the end of the last emitted line (usually the prompt).
    const last = this.lines[cursorY];
    let end = last.cells.length;
    while (end > 0 && !last.cells[end - 1].cont && last.cells[end - 1].ch === ' ') end--;
    this.x = Math.min(end, cols - 1);
    this.pendingWrap = end >= cols;
    this.y = cursorY;
    this.tabStops = new Set();
    for (let i = 8; i < this.cols; i += 8) this.tabStops.add(i);
    this.dirty.clear();
    for (let y = 0; y < rows; y++) this.dirty.add(y);
    this.layoutVersion++;
  }

  clearScrollback() {
    this.scrollback = [];
    this.scrollbackTotal = 0;
    this.layoutVersion++;
  }

  isBlankLine(line) {
    for (const c of line.cells) {
      if (c.ch !== ' ' || c.style !== DEFAULT_STYLE) return false;
    }
    return true;
  }

  // ---------- painting ----------

  printChar(ch, cp) {
    let out = ch;
    if (this.g[this.gl] === 'dec' && cp >= 0x60 && cp <= 0x7e) out = DEC_SPECIAL[ch] || ch;
    if (COMBINING.test(out)) {
      const row = this.lines[this.y].cells;
      let idx = this.pendingWrap ? this.x : this.x - 1;
      if (idx < 0) idx = 0;
      while (idx > 0 && row[idx].cont) idx--;
      const prev = row[idx] || BLANK;
      row[idx] = { ch: prev.ch + out, style: prev.style };
      this.dirty.add(this.y);
      return;
    }
    const width = charWidth(cp);
    if (width === 0) return;
    if (this.pendingWrap) {
      this.lines[this.y].wrapped = true;
      this.x = 0;
      this.linefeed();
      this.pendingWrap = false;
    }
    if (this.x + width > this.cols) {
      this.lines[this.y].wrapped = true;
      this.x = 0;
      this.linefeed();
    }
    const row = this.lines[this.y].cells;
    if (this.insertMode) {
      row.splice(this.x, 0, { ch: out, style: this.pen });
      row.length = this.cols;
    } else {
      row[this.x] = { ch: out, style: this.pen };
    }
    if (width === 2) {
      row[this.x + 1] = { ch: '', style: this.pen, cont: true };
    }
    this.dirty.add(this.y);
    this.x += width;
    if (this.x >= this.cols) {
      this.x = this.cols - 1;
      this.pendingWrap = true;
    }
  }

  control(cp) {
    switch (cp) {
      case 0x07:
        this.bellCount++;
        if (this.onBell) this.onBell();
        break;
      case 0x08:
        this.pendingWrap = false;
        if (this.x > 0) this.x--;
        break;
      case 0x09: {
        this.pendingWrap = false;
        let nx = this.x + 1;
        while (nx < this.cols - 1 && !this.tabStops.has(nx)) nx++;
        this.x = Math.min(nx, this.cols - 1);
        break;
      }
      case 0x0a:
      case 0x0b:
      case 0x0c:
        this.pendingWrap = false;
        this.linefeed();
        break;
      case 0x0d:
        this.pendingWrap = false;
        this.x = 0;
        break;
      case 0x0e: this.gl = 1; break;
      case 0x0f: this.gl = 0; break;
      default:
        break;
    }
  }

  linefeed() {
    this.pendingWrap = false;
    if (this.y === this.scrollBottom) this.scrollUp(1);
    else if (this.y < this.rows - 1) this.y++;
  }

  reverseIndex() {
    this.pendingWrap = false;
    if (this.y === this.scrollTop) this.scrollDown(1);
    else if (this.y > 0) this.y--;
  }

  scrollUp(n = 1) {
    n = Math.max(1, Math.min(n, this.rows));
    const top = this.scrollTop, bottom = this.scrollBottom;
    const full = top === 0 && bottom === this.rows - 1;
    for (let i = 0; i < n; i++) {
      const removed = this.lines.splice(top, 1)[0];
      this.lines.splice(bottom, 0, { cells: blankRow(this.cols, this.eraseStyle()), wrapped: false });
      if (full && !this.alt) {
        if (!(this.isBlankLine(removed) && this.scrollback.length && this.isBlankLine(this.scrollback[this.scrollback.length - 1]))) {
          this.scrollback.push(removed);
          this.scrollbackTotal++;
        }
        if (this.scrollback.length > this.scrollbackLimit) this.scrollback.shift();
      }
    }
    this.markRegionDirty(top, bottom);
  }

  scrollDown(n = 1) {
    n = Math.max(1, Math.min(n, this.rows));
    const top = this.scrollTop, bottom = this.scrollBottom;
    for (let i = 0; i < n; i++) {
      this.lines.splice(bottom, 1);
      this.lines.splice(top, 0, { cells: blankRow(this.cols, this.eraseStyle()), wrapped: false });
    }
    this.markRegionDirty(top, bottom);
  }

  markRegionDirty(a, b) {
    for (let y = a; y <= b; y++) this.dirty.add(y);
  }

  eraseStyle() {
    return this.pen.bg == null ? DEFAULT_STYLE : internStyle(null, this.pen.bg, 0, null);
  }

  // ---------- parser ----------

  parse(ch, cp) {
    switch (this.parseState) {
      case 'esc':
        if (ch === '[') { this.parseState = 'csi'; this.csi = ''; }
        else if (ch === ']') { this.parseState = 'osc'; this.osc = ''; }
        else if (ch === 'P' || ch === 'X' || ch === '^' || ch === '_') { this.parseState = 'string'; }
        else if (ch === '(' || ch === ')') { this.parseState = 'charset'; this.charsetTarget = ch === '(' ? 0 : 1; }
        else if (ch === '#') { this.parseState = 'escHash'; }
        else {
          this.parseState = 'data';
          this.escDispatch(ch);
        }
        break;
      case 'csi':
        if (cp >= 0x40 && cp <= 0x7e) {
          const params = this.csi;
          this.csi = '';
          this.parseState = 'data';
          this.csiDispatch(params, ch);
        } else if (this.csi.length < 128) {
          this.csi += ch;
        } else {
          this.parseState = 'data';
          this.csi = '';
        }
        break;
      case 'osc':
        if (cp === 0x07) { this.oscDispatch(this.osc); this.osc = ''; this.parseState = 'data'; }
        else if (cp === 0x1b) { this.parseState = 'oscEsc'; }
        else if (this.osc.length < 4096) this.osc += ch;
        break;
      case 'oscEsc':
        if (ch === '\\') { this.oscDispatch(this.osc); this.osc = ''; this.parseState = 'data'; }
        else { this.parseState = 'data'; this.osc = ''; }
        break;
      case 'string':
        if (cp === 0x1b) this.parseState = 'stringEsc';
        break;
      case 'stringEsc':
        this.parseState = ch === '\\' ? 'data' : 'string';
        break;
      case 'charset':
        this.parseState = 'data';
        this.g[this.charsetTarget] = ch === '0' ? 'dec' : 'ascii';
        break;
      case 'escHash':
        this.parseState = 'data';
        if (ch === '8') {
          const row = this.lines[this.y].cells;
          for (let x = 0; x < this.cols; x++) row[x] = { ch: 'E', style: DEFAULT_STYLE };
          this.dirty.add(this.y);
        }
        break;
      default:
        this.parseState = 'data';
    }
  }

  escDispatch(ch) {
    switch (ch) {
      case '7': this.saveCursor(); break;
      case '8': this.restoreCursor(); break;
      case 'D': this.linefeed(); break;
      case 'E': this.x = 0; this.linefeed(); break;
      case 'M': this.reverseIndex(); break;
      case 'H': this.tabStops.add(this.x); break;
      case 'c': this.reset(); this.layoutVersion++; break;
      default: break;
    }
  }

  saveCursor() {
    this.savedCursor = {
      x: this.x, y: this.y, pen: this.pen, link: this.link,
      g: this.g.slice(), gl: this.gl, pendingWrap: this.pendingWrap,
    };
  }

  restoreCursor() {
    const s = this.savedCursor;
    if (!s) { this.x = 0; this.y = 0; this.pen = DEFAULT_STYLE; return; }
    this.x = Math.min(s.x, this.cols - 1);
    this.y = Math.min(s.y, this.rows - 1);
    this.pen = s.pen;
    this.link = s.link;
    this.g = s.g.slice();
    this.gl = s.gl;
    this.pendingWrap = s.pendingWrap;
  }

  csiDispatch(raw, final) {
    let privateMark = '';
    if (raw && '?><='.includes(raw[0])) { privateMark = raw[0]; raw = raw.slice(1); }
    const params = raw.length ? raw.split(';') : [];
    const nums = params.map((p) => {
      const n = parseInt(p, 10);
      return Number.isNaN(n) ? 0 : n;
    });
    const p = (i, def = 0) => (nums[i] === undefined || nums[i] === 0 ? def : nums[i]);
    switch (final) {
      case 'A': this.moveY(-p(0, 1)); break;
      case 'B': this.moveY(p(0, 1)); break;
      case 'C': this.moveX(p(0, 1)); break;
      case 'D': this.moveX(-p(0, 1)); break;
      case 'E': this.x = 0; this.moveY(p(0, 1)); break;
      case 'F': this.x = 0; this.moveY(-p(0, 1)); break;
      case 'G': this.x = Math.max(0, Math.min(this.cols - 1, p(0, 1) - 1)); this.pendingWrap = false; break;
      case 'd': this.y = this.clampY(p(0, 1) - 1 + (this.originMode ? this.scrollTop : 0)); this.pendingWrap = false; break;
      case 'H':
      case 'f': {
        const row = p(0, 1) - 1 + (this.originMode ? this.scrollTop : 0);
        const col = p(1, 1) - 1;
        this.y = this.clampY(row);
        this.x = Math.max(0, Math.min(this.cols - 1, col));
        this.pendingWrap = false;
        break;
      }
      case 'J': this.eraseDisplay(nums[0] ?? 0); break;
      case 'K': this.eraseLine(nums[0] ?? 0); break;
      case 'L': this.insertLines(p(0, 1)); break;
      case 'M': this.deleteLines(p(0, 1)); break;
      case 'P': this.deleteChars(p(0, 1)); break;
      case '@': this.insertChars(p(0, 1)); break;
      case 'X': this.eraseChars(p(0, 1)); break;
      case 'S': this.scrollUp(p(0, 1)); break;
      case 'T': this.scrollDown(p(0, 1)); break;
      case 'r': this.setScrollRegion(nums); break;
      case 's': this.saveCursor(); break;
      case 'u': this.restoreCursor(); break;
      case 'h': this.setMode(nums, privateMark === '?', true); break;
      case 'l': this.setMode(nums, privateMark === '?', false); break;
      case 'm': this.sgr(raw); break;
      case 'c':
        if (privateMark === '>') this.respond('\x1b[>0;10;1c');
        else this.respond('\x1b[?1;2c');
        break;
      case 'n':
        if (nums[0] === 5) this.respond('\x1b[0n');
        else if (nums[0] === 6) this.respond(`\x1b[${this.y + 1};${this.x + 1}R`);
        break;
      case 'g':
        if ((nums[0] ?? 0) === 0) this.tabStops.delete(this.x);
        else if (nums[0] === 3) this.tabStops.clear();
        break;
      case 't': break; // window ops (title, size report) ignored
      case 'q': break; // cursor style
      default: break;
    }
  }

  respond(s) {
    if (this.onResponse) this.onResponse(s);
  }

  clampY(y) {
    let lo = 0, hi = this.rows - 1;
    if (this.originMode) { lo = this.scrollTop; hi = this.scrollBottom; }
    return Math.max(lo, Math.min(hi, y));
  }

  moveY(dy) {
    this.pendingWrap = false;
    this.y = this.clampY(this.y + dy);
  }
  moveX(dx) {
    this.pendingWrap = false;
    this.x = Math.max(0, Math.min(this.cols - 1, this.x + dx));
  }

  setScrollRegion(nums) {
    let top = (nums[0] || 1) - 1;
    let bottom = (nums[1] || this.rows) - 1;
    top = Math.max(0, Math.min(this.rows - 1, top));
    bottom = Math.max(0, Math.min(this.rows - 1, bottom));
    if (bottom <= top) { top = 0; bottom = this.rows - 1; }
    this.scrollTop = top;
    this.scrollBottom = bottom;
    this.x = 0;
    this.y = this.originMode ? top : 0;
    this.pendingWrap = false;
  }

  eraseDisplay(mode) {
    const style = this.eraseStyle();
    if (mode === 0) {
      this.eraseLine(0);
      for (let y = this.y + 1; y < this.rows; y++) {
        this.lines[y] = { cells: blankRow(this.cols, style), wrapped: false };
        this.dirty.add(y);
      }
    } else if (mode === 1) {
      for (let y = 0; y < this.y; y++) {
        this.lines[y] = { cells: blankRow(this.cols, style), wrapped: false };
        this.dirty.add(y);
      }
      this.eraseLine(1);
    } else if (mode === 2) {
      for (let y = 0; y < this.rows; y++) {
        this.lines[y] = { cells: blankRow(this.cols, style), wrapped: false };
        this.dirty.add(y);
      }
    } else if (mode === 3) {
      this.clearScrollback();
    }
    this.pendingWrap = false;
  }

  eraseLine(mode) {
    const row = this.lines[this.y].cells;
    const style = this.eraseStyle();
    if (mode === 0) {
      for (let x = this.x; x < this.cols; x++) row[x] = blankCell(style);
    } else if (mode === 1) {
      for (let x = 0; x <= this.x && x < this.cols; x++) row[x] = blankCell(style);
    } else {
      for (let x = 0; x < this.cols; x++) row[x] = blankCell(style);
    }
    this.dirty.add(this.y);
  }

  insertLines(n) {
    if (this.y < this.scrollTop || this.y > this.scrollBottom) return;
    n = Math.max(1, Math.min(n, this.scrollBottom - this.y + 1));
    for (let i = 0; i < n; i++) {
      this.lines.splice(this.scrollBottom, 1);
      this.lines.splice(this.y, 0, { cells: blankRow(this.cols, this.eraseStyle()), wrapped: false });
    }
    this.markRegionDirty(this.y, this.scrollBottom);
  }

  deleteLines(n) {
    if (this.y < this.scrollTop || this.y > this.scrollBottom) return;
    n = Math.max(1, Math.min(n, this.scrollBottom - this.y + 1));
    for (let i = 0; i < n; i++) {
      this.lines.splice(this.y, 1);
      this.lines.splice(this.scrollBottom, 0, { cells: blankRow(this.cols, this.eraseStyle()), wrapped: false });
    }
    this.markRegionDirty(this.y, this.scrollBottom);
  }

  insertChars(n) {
    const row = this.lines[this.y].cells;
    n = Math.max(1, Math.min(n, this.cols - this.x));
    row.splice(this.x, 0, ...blankRow(n, this.eraseStyle()));
    row.length = this.cols;
    this.dirty.add(this.y);
    this.pendingWrap = false;
  }

  deleteChars(n) {
    const row = this.lines[this.y].cells;
    n = Math.max(1, Math.min(n, this.cols - this.x));
    row.splice(this.x, n);
    row.push(...blankRow(n, this.eraseStyle()));
    this.dirty.add(this.y);
    this.pendingWrap = false;
  }

  eraseChars(n) {
    const row = this.lines[this.y].cells;
    const style = this.eraseStyle();
    n = Math.max(1, Math.min(n, this.cols - this.x));
    for (let x = this.x; x < this.x + n; x++) row[x] = blankCell(style);
    this.dirty.add(this.y);
    this.pendingWrap = false;
  }

  setMode(nums, priv, on) {
    for (const n of nums) {
      if (priv) {
        if (n === 7) this.autoWrap = on;
        else if (n === 6) { this.originMode = on; this.x = 0; this.y = on ? this.scrollTop : 0; }
        else if (n === 25) this.cursorVisible = on;
        else if (n === 47 || n === 1047 || n === 1049) { on ? this.enterAlt() : this.exitAlt(); }
        else if (n === 1048) { on ? this.saveCursor() : this.restoreCursor(); }
      } else {
        if (n === 4) this.insertMode = on;
      }
    }
  }

  enterAlt() {
    if (this.alt) return;
    this.altSaved = {
      lines: this.lines, x: this.x, y: this.y, pendingWrap: this.pendingWrap,
      scrollTop: this.scrollTop, scrollBottom: this.scrollBottom,
      pen: this.pen, g: this.g.slice(), gl: this.gl,
    };
    this.alt = true;
    this.lines = Array.from({ length: this.rows }, () => ({ cells: blankRow(this.cols), wrapped: false }));
    this.x = 0; this.y = 0; this.pendingWrap = false;
    this.scrollTop = 0; this.scrollBottom = this.rows - 1;
    this.dirty.clear();
    for (let y = 0; y < this.rows; y++) this.dirty.add(y);
    this.layoutVersion++;
  }

  exitAlt() {
    if (!this.alt || !this.altSaved) return;
    const s = this.altSaved;
    this.lines = s.lines;
    this.x = Math.min(s.x, this.cols - 1);
    this.y = Math.min(s.y, this.rows - 1);
    this.pendingWrap = s.pendingWrap;
    this.scrollTop = s.scrollTop;
    this.scrollBottom = s.scrollBottom;
    this.pen = s.pen;
    this.g = s.g;
    this.gl = s.gl;
    this.alt = false;
    this.altSaved = null;
    this.dirty.clear();
    for (let y = 0; y < this.rows; y++) this.dirty.add(y);
    this.layoutVersion++;
  }

  sgr(raw) {
    const tokens = raw.split(';');
    let fg = this.pen.fg;
    let bg = this.pen.bg;
    let flags = this.pen.flags;
    const setFlag = (f, on) => { flags = on ? (flags | f) : (flags & ~f); };
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const colon = token.includes(':') ? token.split(':') : null;
      const n = colon ? parseInt(colon[0], 10) || 0 : (parseInt(token, 10) || 0);
      if (n === 0) { fg = null; bg = null; flags = 0; this.link = null; }
      else if (n === 1) setFlag(BOLD, true);
      else if (n === 2) setFlag(DIM, true);
      else if (n === 3) setFlag(ITALIC, true);
      else if (n === 4) setFlag(UNDERLINE, true);
      else if (n === 5 || n === 6) setFlag(BLINK, true);
      else if (n === 7) setFlag(INVERSE, true);
      else if (n === 8) setFlag(HIDDEN, true);
      else if (n === 9) setFlag(STRIKE, true);
      else if (n === 21) setFlag(UNDERLINE, true);
      else if (n === 22) { setFlag(BOLD, false); setFlag(DIM, false); }
      else if (n === 23) setFlag(ITALIC, false);
      else if (n === 24) setFlag(UNDERLINE, false);
      else if (n === 25) setFlag(BLINK, false);
      else if (n === 27) setFlag(INVERSE, false);
      else if (n === 28) setFlag(HIDDEN, false);
      else if (n === 29) setFlag(STRIKE, false);
      else if (n >= 30 && n <= 37) fg = n - 30;
      else if (n === 38) {
        const r = this.extColor(tokens, i, colon);
        if (r) { fg = r.color; i = r.next; }
      } else if (n === 39) fg = null;
      else if (n >= 40 && n <= 47) bg = n - 40;
      else if (n === 48) {
        const r = this.extColor(tokens, i, colon);
        if (r) { bg = r.color; i = r.next; }
      } else if (n === 49) bg = null;
      else if (n === 58) {
        const r = this.extColor(tokens, i, colon);
        if (r) i = r.next; // underline colour: parsed but not rendered
      } else if (n >= 90 && n <= 97) fg = n - 90 + 8;
      else if (n >= 100 && n <= 107) bg = n - 100 + 8;
      // others ignored
    }
    // Hyperlinks live on the pen until OSC 8 clears them.
    this.pen = internStyle(fg, bg, flags, this.pen.link);
  }

  extColor(tokens, i, colon) {
    let mode, values;
    if (colon) {
      values = colon.slice(1).map((x) => parseInt(x, 10) || 0);
      mode = values.shift();
      // 38:2::r:g:b -> colourspace (empty) shifts values
      if (mode === 2 && values.length >= 4) values = values.slice(values.length - 3);
      if (mode === 5) return { color: xterm256(values[0] || 0), next: i };
      if (mode === 2) return { color: rgb(values[0], values[1], values[2]), next: i };
      return null;
    }
    mode = parseInt(tokens[i + 1], 10) || 0;
    if (mode === 5) {
      const n = parseInt(tokens[i + 2], 10) || 0;
      return { color: xterm256(n), next: i + 2 };
    }
    if (mode === 2) {
      const r = parseInt(tokens[i + 2], 10) || 0;
      const g = parseInt(tokens[i + 3], 10) || 0;
      const b = parseInt(tokens[i + 4], 10) || 0;
      return { color: rgb(r, g, b), next: i + 4 };
    }
    return null;
  }

  oscDispatch(s) {
    if (!s) return;
    const m = s.match(/^([0-9]+);(.*)$/s);
    if (!m) return;
    const code = m[1];
    if (code === '0' || code === '2') {
      const title = m[2].replace(/[\x00-\x1f]/g, '').slice(0, 200);
      this.title = title;
      if (this.onTitle) this.onTitle(title);
    } else if (code === '8') {
      const parts = m[2].split(';');
      const uri = parts.slice(1).join(';');
      if (uri) this.pen = internStyle(this.pen.fg, this.pen.bg, this.pen.flags, uri);
      else this.pen = internStyle(this.pen.fg, this.pen.bg, this.pen.flags, null);
    }
  }
}

export function xterm256(n) {
  n = Math.max(0, Math.min(255, n | 0));
  if (n < 16) return n;
  if (n < 232) {
    const i = n - 16;
    const r = Math.floor(i / 36) * 51;
    const g = Math.floor((i % 36) / 6) * 51;
    const b = (i % 6) * 51;
    return rgb(r, g, b);
  }
  const v = 8 + (n - 232) * 10;
  return rgb(v, v, v);
}

export function rgb(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Convert cells to style runs. Trailing default-styled spaces are dropped.
export function cellsToRuns(cells) {
  let end = cells.length;
  while (end > 0) {
    const c = cells[end - 1];
    if (!c.cont && c.ch === ' ' && c.style === DEFAULT_STYLE) end--;
    else break;
  }
  const runs = [];
  let cur = null;
  for (let i = 0; i < end; i++) {
    const cell = cells[i];
    if (cell.cont) continue;
    const ch = cell.ch || ' ';
    if (cur && cur.style === cell.style) cur.text += ch;
    else { cur = { text: ch, style: cell.style }; runs.push(cur); }
  }
  return runs;
}

export function stripAnsi(s) {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '');
}

// Code page 437 -> Unicode. MUD ANSI art often predates UTF-8.
const CP437_HIGH = (
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0'
);
const CP437 = new Array(256);
for (let i = 0; i < 256; i++) CP437[i] = i < 128 ? String.fromCharCode(i) : (CP437_HIGH[i - 128] ?? '?');
export { CP437 };
