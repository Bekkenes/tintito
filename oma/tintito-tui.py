#!/usr/bin/env python3
# TinTito terminal client for Omalauncher. Direct telnet or TLS; no bridge.
import os, sys, socket, ssl, select, signal, termios, tty

IAC = 255
DONT = 254
DO = 253
WONT = 252
WILL = 251
SB = 250
SE = 240
ECHO = 1
SGA = 3
TTYPE = 24
NAWS = 31
CHARSET = 42
TTYPE_IS = 0
TTYPE_SEND = 1
CHARSET_REQUEST = 1
CHARSET_ACCEPTED = 2
CHARSET_REJECTED = 3

CR = 13
LF = 10
CTRL_RIGHT_BRACKET = 29
CRLF = bytes([13, 10])
ESC = chr(27)
BEL = chr(7)


def terminal_size():
    try:
        size = os.get_terminal_size(1)
        return max(2, size.columns), max(2, size.lines)
    except OSError:
        return 80, 24


class Telnet:
    def __init__(self, sock):
        self.sock = sock
        self.state = 0
        self.cmd = 0
        self.sb = []
        self.local = {}
        self.remote = {}
        self.naws = False
        self.name = "XTERM-256COLOR"

    def send(self, data):
        try:
            self.sock.sendall(data)
        except OSError:
            pass

    def reply(self, cmd, opt):
        self.send(bytes([IAC, cmd, opt]))

    def sub(self, opt, payload):
        self.send(bytes([IAC, SB, opt]) + bytes(payload) + bytes([IAC, SE]))

    def send_naws(self):
        w, h = terminal_size()
        self.send(bytes([IAC, SB, NAWS, (w >> 8) & 255, w & 255,
                         (h >> 8) & 255, h & 255, IAC, SE]))

    def negotiate(self, cmd, opt):
        if cmd == DO:
            if self.local.get(opt):
                return
            if opt in (NAWS, TTYPE, SGA, CHARSET):
                self.local[opt] = True
                self.reply(WILL, opt)
                if opt == NAWS:
                    self.naws = True
                    self.send_naws()
            else:
                self.reply(WONT, opt)
        elif cmd == WILL:
            if self.remote.get(opt):
                return
            if opt in (ECHO, SGA, CHARSET):
                self.remote[opt] = True
                self.reply(DO, opt)
                if opt == CHARSET:
                    self.sub(CHARSET, [CHARSET_REQUEST] + list(b"UTF-8"))
            else:
                self.reply(DONT, opt)
        elif cmd == WONT:
            self.remote[opt] = False
        elif cmd == DONT:
            self.local[opt] = False
            if opt == NAWS:
                self.naws = False

    def subneg(self, payload):
        if len(payload) < 2:
            return
        opt = payload[0]
        body = payload[1:]
        if opt == TTYPE and body and body[0] == TTYPE_SEND:
            self.sub(TTYPE, [TTYPE_IS] + list(self.name.encode("ascii", "ignore")))
        elif opt == CHARSET and body and body[0] == CHARSET_REQUEST:
            text = bytes(body[1:]).decode("ascii", "ignore")
            offered = [x for x in text.replace(chr(0), ";").split(";") if x]
            ok = any(x.upper().replace("-", "").replace("_", "") == "UTF8" for x in offered)
            if ok:
                self.sub(CHARSET, [CHARSET_ACCEPTED] + list(b"UTF-8"))
            else:
                self.sub(CHARSET, [CHARSET_REJECTED] + list(b"UTF-8"))

    def feed(self, data):
        out = bytearray()
        for b in data:
            if self.state == 0:
                if b == IAC:
                    self.state = 1
                else:
                    out.append(b)
            elif self.state == 1:
                if b == IAC:
                    out.append(255)
                    self.state = 0
                elif b in (DO, DONT, WILL, WONT):
                    self.cmd = b
                    self.state = 2
                elif b == SB:
                    self.sb = []
                    self.state = 3
                else:
                    self.state = 0
            elif self.state == 2:
                self.negotiate(self.cmd, b)
                self.state = 0
            elif self.state == 3:
                if b == IAC:
                    self.state = 4
                else:
                    self.sb.append(b)
            elif self.state == 4:
                if b == SE:
                    self.subneg(self.sb)
                    self.sb = []
                    self.state = 0
                elif b == IAC:
                    self.sb.append(255)
                    self.state = 3
                else:
                    self.state = 3
        return bytes(out)


def run(host, port, tls):
    try:
        sock = socket.create_connection((host, port), timeout=20)
        if tls:
            context = ssl.create_default_context()
            sock = context.wrap_socket(sock, server_hostname=host)
        sock.setblocking(True)
    except Exception as exc:
        sys.stdout.write("TinTito: " + str(exc) + chr(10))
        sys.stdout.flush()
        return 1

    fd = sys.stdin.fileno()
    old = None
    try:
        old = termios.tcgetattr(fd)
        tty.setraw(fd)
        telnet = Telnet(sock)
        resized = [False]

        def on_winch(signum, frame):
            resized[0] = True

        signal.signal(signal.SIGWINCH, on_winch)
        sys.stdout.buffer.write((ESC + "]0;TinTito" + BEL).encode())
        sys.stdout.buffer.flush()
        skip_lf = False
        while True:
            if resized[0]:
                resized[0] = False
                if telnet.naws:
                    telnet.send_naws()
            try:
                ready, _, _ = select.select([sock, fd], [], [], 1.0)
            except InterruptedError:
                continue
            if fd in ready:
                try:
                    data = os.read(fd, 4096)
                except OSError:
                    data = b""
                if not data:
                    break
                if CTRL_RIGHT_BRACKET in data:
                    break
                outgoing = bytearray()
                for b in data:
                    if b == CR:
                        outgoing.extend(CRLF)
                        skip_lf = True
                    elif b == LF:
                        if skip_lf:
                            skip_lf = False
                        else:
                            outgoing.append(LF)
                    else:
                        skip_lf = False
                        outgoing.append(b)
                if outgoing:
                    try:
                        sock.sendall(bytes(outgoing))
                    except OSError:
                        break
            if sock in ready:
                try:
                    data = sock.recv(65536)
                except OSError:
                    data = b""
                if not data:
                    break
                clean = telnet.feed(data)
                if clean:
                    sys.stdout.buffer.write(clean)
                    sys.stdout.buffer.flush()
    except KeyboardInterrupt:
        pass
    finally:
        if old is not None:
            try:
                termios.tcsetattr(fd, termios.TCSADRAIN, old)
            except Exception:
                pass
        try:
            sock.close()
        except Exception:
            pass
    sys.stdout.write(chr(13) + chr(10) + "[TinTito] disconnected" + chr(13) + chr(10))
    sys.stdout.flush()
    return 0


def main():
    if len(sys.argv) < 3:
        print("usage: tintito-tui.py host port [tls]")
        return 2
    host = sys.argv[1]
    try:
        port = int(sys.argv[2])
    except ValueError:
        print("TinTito: invalid port")
        return 2
    tls = len(sys.argv) > 3 and sys.argv[3] == "1"
    return run(host, port, tls)


if __name__ == "__main__":
    raise SystemExit(main())
