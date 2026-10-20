#!/usr/bin/env python3
"""Build the generated Omalauncher OWL app from the template, client and icon."""
import base64
from pathlib import Path

here = Path(__file__).resolve().parent
client = (here / 'tintito-tui.py').read_text()
icon = base64.b64encode((here.parent / 'assets' / 'icon-oma-192.png').read_bytes()).decode()
template = (here / 'app.template.owl').read_text()

assert '"""' not in client, 'client has an OWL terminator'
assert '${' not in client, 'client has OWL interpolation'
assert '\\' not in client, 'client has backslashes that OWL may rewrite'
assert 'TINTITO_OMA_PY' not in client, 'client collides with the heredoc delimiter'
assert '__CLIENT__' in template and '__ICON__' in template

app = template.replace('__CLIENT__', client.rstrip('\n')).replace('__ICON__', icon)
(here / 'app.owl').write_text(app)
print('wrote app.owl', len(app), 'bytes')
