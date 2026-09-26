"""Local development server for Swaralaya — no Docker needed.

Serves the website exactly the way the C++ server's StaticController does
(the SPA routes /lehra, /notation, /practice … get index.html; /separator
serves the exported Stem Separator; only the site's own files are public),
with the same no-cache policy so edited ES modules always reload.

Everything that runs in the browser works: Lehra player, tuner, recording,
Notation Editor, Carnatic suite. The Stem Separator's API (/api/…) needs the
real server (Demucs), so it answers with a clear message instead:
run `docker compose up --build` for the full site.

Usage (from webapp/):   python tools/dev_server.py [port]      default 3000
Standard library only; Python 3.8+.
"""
import json
import mimetypes
import os
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # webapp/
ROOT_FILES = {'sw.js', 'manifest.json', 'favicon.ico'}
SPA_ROUTES = {'lehra', 'hindustani', 'carnatic', 'notation', 'practice'}
TYPES = {  # explicit: Windows' registry maps some of these oddly (e.g. .aac)
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
    '.aac': 'audio/aac', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
}
API_MESSAGE = ('The Stem Separator needs the full server (it runs Demucs). '
               'Start the site with Docker instead: docker compose up --build')


def safe_join(base, rel):
    """base/rel if it stays inside base (no path traversal), else None."""
    base = os.path.realpath(base)
    target = os.path.realpath(os.path.join(base, rel))
    return target if target == base or target.startswith(base + os.sep) else None


class Handler(SimpleHTTPRequestHandler):
    server_version = 'SwaralayaDev/1.0'

    def log_message(self, fmt, *args):
        sys.stderr.write('  %s\n' % (fmt % args))

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')  # like the real server's max-age=0
        super().end_headers()

    def guess_type(self, path):
        return TYPES.get(os.path.splitext(path)[1].lower()) or mimetypes.guess_type(path)[0] or 'application/octet-stream'

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def resolve(self, path):
        """Map a URL path to a file on disk (or None → 404), as StaticController does."""
        rel = unquote(path).lstrip('/')
        if rel in ('', 'index.html') or rel.rstrip('/') in SPA_ROUTES:
            return os.path.join(ROOT, 'index.html')
        if rel in ROOT_FILES:
            return os.path.join(ROOT, rel)
        for prefix, base in (('assets/', 'assets'), ('public/', 'public'),
                             ('_next/', os.path.join('public', 'separator', '_next'))):
            if rel.startswith(prefix):
                return safe_join(os.path.join(ROOT, base), rel[len(prefix):])
        if rel == 'separator' or rel.startswith('separator/'):
            sep = os.path.join(ROOT, 'public', 'separator')
            target = safe_join(sep, rel[len('separator/'):]) if rel != 'separator' else sep
            if target and os.path.isdir(target):
                target = os.path.join(target, 'index.html')
            if not target or not os.path.isfile(target):
                target = os.path.join(sep, 'index.html')  # the separator's own 404 handling
            return target
        return None

    def handle_get(self):
        path = urlsplit(self.path).path
        if path in ('/health', '/api/status', '/api/health'):
            return self.send_json(200, {'status': 'ok', 'server': 'dev (no stem separation)'})
        if path.startswith('/api/'):
            return self.send_json(503, {'error': API_MESSAGE})
        target = self.resolve(path)
        if not target or not os.path.isfile(target):
            return self.send_error(404)
        self.path = '/' + os.path.relpath(target, ROOT).replace(os.sep, '/')
        return super().do_HEAD() if self.command == 'HEAD' else super().do_GET()

    def do_GET(self):
        self.handle_get()

    def do_HEAD(self):
        self.handle_get()

    def do_POST(self):
        self.send_json(503, {'error': API_MESSAGE})

    do_DELETE = do_POST


class IPv6Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    os.chdir(ROOT)
    handler = lambda *a: Handler(*a, directory=ROOT)  # noqa: E731
    try:
        httpd = ThreadingHTTPServer(('127.0.0.1', port), handler)
    except OSError:
        sys.exit(f'Port {port} is already in use — is the site already running? '
                 f'Open http://localhost:{port} or pass another port: python tools/dev_server.py 3001')
    # "localhost" resolves to ::1 first on Windows: answer there too (loopback
    # only), or every new connection waits ~2 s before falling back to IPv4.
    try:
        httpd6 = IPv6Server(('::1', port), handler)
        threading.Thread(target=httpd6.serve_forever, daemon=True).start()
    except OSError:
        pass  # no IPv6: clients fall back to 127.0.0.1
    print(f'Swaralaya dev server: http://localhost:{port}   (Ctrl+C to stop)', flush=True)
    print('Everything in the browser works; the Stem Separator needs Docker (docker compose up --build).', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')


if __name__ == '__main__':
    main()
