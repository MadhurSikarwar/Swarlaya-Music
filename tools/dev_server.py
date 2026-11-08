"""Local development server for Swaralaya — no Docker needed.

Serves the website exactly the way the C++ server's StaticController does
(the SPA routes /lehra, /notation, /practice … get index.html; /separator
serves the exported Stem Separator; only the site's own files are public),
with the same no-cache policy so edited ES modules always reload.

Everything that runs in the browser works: Lehra player, tuner, recording,
Notation Editor, Carnatic suite. The Stem Separator's API (/api/…) needs the
real server (Demucs), so it answers with a clear message instead:
run `docker compose up --build` for the full site.

The Audio Lab's API (/api/master/…) is forwarded to the audio_lab service,
which you start separately (from webapp/):
    python -m uvicorn audio_lab.server:app --port 8100
Set AUDIO_LAB_URL to forward somewhere else.

Usage (from webapp/):   python tools/dev_server.py [port]      default 3000
Standard library only; Python 3.8+.

To check the static build (node tools/build-static.mjs) as a static host
serves it — a page per route, robots.txt, sitemap.xml — pass its folder:
                        python tools/dev_server.py 3001 dist
"""
import http.client
import json
import mimetypes
import os
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # webapp/
ROOT_FILES = {'sw.js', 'manifest.json', 'favicon.ico', 'robots.txt', 'sitemap.xml'}  # sitemap: static build only
SPA_ROUTES = {'lehra', 'hindustani', 'carnatic', 'notation', 'practice', 'games', 'account', 'audio'}
TYPES = {  # explicit: Windows' registry maps some of these oddly (e.g. .aac)
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
    '.aac': 'audio/aac', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
}
AUDIO_LAB_URL = os.environ.get('AUDIO_LAB_URL', 'http://127.0.0.1:8100')
AUDIO_LAB_PREFIX = '/api/master'
HOP_BY_HOP = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers',
              'transfer-encoding', 'upgrade', 'host', 'accept-encoding', 'cache-control'}
AUDIO_LAB_MESSAGE = ('The Audio Lab service is not running. Start it from the webapp folder: '
                     'python -m uvicorn audio_lab.server:app --port 8100')
API_MESSAGE = ('The Stem Separator needs the full server (it runs Demucs). '
               'Start the site with Docker instead: docker compose up --build')


class Body:
    """The request body as a file-like object limited to `length` bytes, so uploads stream through un-buffered."""

    def __init__(self, rfile, length):
        self.rfile, self.left = rfile, length

    def read(self, n=-1):
        n = self.left if n is None or n < 0 else min(n, self.left)
        data = self.rfile.read(n) if n else b''
        self.left -= len(data)
        return data


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

    def proxy_audio_lab(self):
        """Forward /api/master/… to the Audio Lab service, streaming both ways (uploads, server-sent events)."""
        target = urlsplit(AUDIO_LAB_URL)
        length = int(self.headers.get('Content-Length') or 0)
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP}
        try:
            conn = http.client.HTTPConnection(target.hostname, target.port or 80, timeout=120)
            conn.request(self.command, self.path, body=Body(self.rfile, length) if length else None, headers=headers)
            upstream = conn.getresponse()
        except OSError:
            return self.send_json(503, {'error': AUDIO_LAB_MESSAGE, 'code': 'unavailable'})
        self.send_response(upstream.status)
        for key, value in upstream.getheaders():
            if key.lower() not in HOP_BY_HOP:
                self.send_header(key, value)
        self.end_headers()      # (HTTP/1.0: the body ends when the connection closes)
        try:
            if self.command != 'HEAD':
                while True:
                    chunk = upstream.read1(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except (OSError, ValueError):
            pass                # the browser went away (a closed event stream)
        finally:
            conn.close()

    def resolve(self, path):
        """Map a URL path to a file on disk (or None → 404), as StaticController does."""
        rel = unquote(path).lstrip('/')
        if rel in ('', 'index.html') or rel.rstrip('/') in SPA_ROUTES:
            # A static build has a page per route; the source tree has the one index.html
            page = os.path.join(ROOT, rel.rstrip('/'), 'index.html')
            return page if os.path.isfile(page) else os.path.join(ROOT, 'index.html')
        if rel in ROOT_FILES or (rel.startswith('google') and rel.endswith('.html')):
            return os.path.join(ROOT, rel)
        sep = os.path.join(ROOT, 'public', 'separator')
        if not os.path.isdir(sep):
            sep = os.path.join(ROOT, 'separator')  # where the static build puts it
        for prefix, base in (('assets/', os.path.join(ROOT, 'assets')), ('public/', os.path.join(ROOT, 'public')),
                             ('_next/', os.path.join(sep, '_next'))):
            if rel.startswith(prefix):
                return safe_join(base, rel[len(prefix):])
        if rel == 'separator' or rel.startswith('separator/'):
            target = safe_join(sep, rel[len('separator/'):]) if rel != 'separator' else sep
            if target and os.path.isdir(target):
                target = os.path.join(target, 'index.html')
            if not target or not os.path.isfile(target):
                target = os.path.join(sep, 'index.html')  # the separator's own 404 handling
            return target
        return None

    def handle_get(self):
        path = urlsplit(self.path).path
        if path == '/health':  # the launcher waits for this
            return self.send_json(200, {'status': 'ok', 'server': 'dev (no stem separation)'})
        if path == AUDIO_LAB_PREFIX or path.startswith(AUDIO_LAB_PREFIX + '/'):
            return self.proxy_audio_lab()
        if path.startswith('/api/'):  # incl. /api/status: the pages check it to see if the separator is here
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
        if urlsplit(self.path).path.startswith(AUDIO_LAB_PREFIX + '/'):
            return self.proxy_audio_lab()
        self.send_json(503, {'error': API_MESSAGE})

    do_DELETE = do_POST
    do_OPTIONS = do_POST


class IPv6Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def main():
    global ROOT
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    if len(sys.argv) > 2:  # a static build to serve instead of the source tree
        ROOT = os.path.abspath(sys.argv[2])
        if not os.path.isfile(os.path.join(ROOT, 'index.html')):
            sys.exit(f'{ROOT} has no index.html — build it first: node tools/build-static.mjs')
        # (not made the working directory: Windows couldn't replace the folder on the next build)
    else:
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
