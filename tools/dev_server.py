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

start_website.bat runs it with --open: it opens the browser once the site is
up, just opens it if the site is already running, and moves to the next free
port when another program is using this one.

To check the static build (node tools/build-static.mjs) as a static host
serves it — a page per route, robots.txt, sitemap.xml — pass its folder:
                        python tools/dev_server.py 3001 dist
"""
import errno
import http.client
import json
import mimetypes
import os
import socket
import sys
import threading
import webbrowser
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
# The Server header of this site's own servers: this one and the C++ one (drogon_server/config.json)
SERVER_NAMES = ('SwaralayaDev/', 'Lehra-Drogon/')
PORT_TRIES = 10  # with --open: how many ports to try when the first one is taken
# Binding ::1 fails with these when another program has the port (other errors: no IPv6 here)
IN_USE = {errno.EADDRINUSE, errno.EACCES, 10048, 10013}  # 10048/10013: WSAEADDRINUSE/WSAEACCES


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


class LoopbackServer(ThreadingHTTPServer):
    # On Windows, SO_REUSEADDR (which HTTPServer sets) lets a second server bind
    # a port another program is already listening on: both then get connections
    # and the pages half-load forever. Bind it exclusively there instead.
    allow_reuse_address = not hasattr(socket, 'SO_EXCLUSIVEADDRUSE')

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class IPv6Server(LoopbackServer):
    address_family = socket.AF_INET6


def bind(port, handler):
    """(IPv4 server, IPv6 server or None) on loopback `port`, or None if another program has it."""
    try:
        httpd = LoopbackServer(('127.0.0.1', port), handler)
    except OSError:
        return None
    # "localhost" resolves to ::1 first on Windows: answer there too, or every
    # new connection waits ~2 s before falling back to IPv4 — and if another
    # program has ::1 on this port (Node's "localhost"), browsers would reach it instead.
    try:
        httpd6 = IPv6Server(('::1', port), handler)
    except OSError as err:
        if err.errno in IN_USE:
            httpd.server_close()
            return None
        httpd6 = None  # no IPv6: clients fall back to 127.0.0.1
    return httpd, httpd6


def running_here(port):
    """Whether this site (this server or the Docker one) already answers on `port`."""
    for host in ('127.0.0.1', '::1'):
        conn = http.client.HTTPConnection(host, port, timeout=3)
        try:
            conn.request('GET', '/health')
            resp = conn.getresponse()
            if resp.status == 200 and (resp.getheader('Server') or '').startswith(SERVER_NAMES):
                return True
        except (OSError, http.client.HTTPException):
            pass  # nothing there, no IPv6, or another program that doesn't speak HTTP / hangs
        finally:
            conn.close()
    return False


def main():
    global ROOT
    args = sys.argv[1:]
    open_browser = '--open' in args  # start_website.bat
    args = [a for a in args if a != '--open']
    port = int(args[0]) if args else 3000
    if len(args) > 1:  # a static build to serve instead of the source tree
        ROOT = os.path.abspath(args[1])
        if not os.path.isfile(os.path.join(ROOT, 'index.html')):
            sys.exit(f'{ROOT} has no index.html — build it first: node tools/build-static.mjs')
        # (not made the working directory: Windows couldn't replace the folder on the next build)
    else:
        os.chdir(ROOT)
    handler = lambda *a: Handler(*a, directory=ROOT)  # noqa: E731

    servers = None
    last = port + (PORT_TRIES if open_browser else 1) - 1
    for candidate in range(port, last + 1):
        servers = bind(candidate, handler)
        if servers:
            port = candidate
            break
        if running_here(candidate):
            print(f'Swaralaya is already running: http://localhost:{candidate}', flush=True)
            if open_browser:
                webbrowser.open(f'http://localhost:{candidate}/')
            return
        if candidate < last:
            print(f'Port {candidate} is being used by another program on this computer, trying {candidate + 1}...',
                  flush=True)
    if not servers:
        ports = f'Port {port} is' if last == port else f'Ports {port}-{last} are all'
        sys.exit(f'{ports} being used by other programs. Pass another port: python tools/dev_server.py {last + 1}')
    httpd, httpd6 = servers
    if httpd6:
        threading.Thread(target=httpd6.serve_forever, daemon=True).start()

    url = f'http://localhost:{port}/'
    print(f'Swaralaya dev server: {url}   (Ctrl+C to stop)', flush=True)
    print('Everything in the browser works; the Stem Separator needs Docker (docker compose up --build).', flush=True)
    if open_browser:
        webbrowser.open(url)  # the sockets are listening already: the first request waits in the queue
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')


if __name__ == '__main__':
    main()
