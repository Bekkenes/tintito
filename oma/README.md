# TinTito for Omalauncher

This folder is the Omalauncher store edition of TinTito: a direct telnet/TLS
MUD client that runs in the launcher's embedded terminal. It is **not** a
replacement for the browser PWA at the repository root; it is a second install
path for people who live in the launcher.

- `tintito-tui.py` — self-contained Python 3 terminal client (telnet NAWS,
  TTYPE, CHARSET, ECHO/SGA; ANSI passthrough; TLS with the system CA store).
- `app.template.owl` — the OWL app: setup screen, presets, TLS toggle, text
  size, and the embedded `Terminal`.
- `app.owl` — generated, self-contained store app (client + icon embedded).
- `preview.png` — the store preview, rendered from a real terminal session.
- `build.py` — regenerates `app.owl` after changing the template, client, or
  `assets/icon-oma-192.png`.

Build:

```sh
python3 oma/build.py
java -jar path/to/owl.jar check oma/app.owl
```

Controls: tap the terminal to type, `Ctrl-]` disconnects, and the title-bar
back chevron returns to the setup screen. Packages: `python`.

The store copy lives under `apps/bekkenes/tintito/` in
[SimonSchubert/omarchy-widgets](https://github.com/SimonSchubert/omarchy-widgets).
