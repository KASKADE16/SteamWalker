#!/usr/bin/env python3
"""Steam Walker local server.

Serves the prototype and a tiny read-only proxy for public Steam profile pages.
Steam does not send CORS headers for steamcommunity.com, so the browser cannot
read those pages directly. Run this instead of `python -m http.server`:

    py -3 server.py

then open http://127.0.0.1:8765/ (or double-click index.html while this is up).
The proxy only allows steamcommunity.com and never logs in anywhere.
"""
import http.server
import os
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser

PORT = int(os.environ.get("PORT", "8765"))
ROOT = os.path.dirname(os.path.abspath(__file__))
ALLOWED_HOSTS = {"steamcommunity.com", "www.steamcommunity.com"}
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
      "AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _plain(self, code, text):
        body = text.encode("utf-8", "replace")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/steam":
            qs = urllib.parse.parse_qs(parsed.query)
            target = qs.get("url", [""])[0]
            self._proxy(target)
            return
        super().do_GET()

    def _proxy(self, target):
        p = urllib.parse.urlparse(target)
        if p.scheme not in ("http", "https") or p.hostname not in ALLOWED_HOSTS:
            self._plain(400, "bad target")
            return
        req = urllib.request.Request(target, headers={
            "User-Agent": UA,
            "Accept": "text/xml,application/xml,text/html;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "identity",
        })
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                data = r.read()
                self.send_response(200)
                self.send_header("Content-Type", r.headers.get("Content-Type", "text/xml; charset=utf-8"))
                self._cors()
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
        except Exception as e:
            self._plain(502, "proxy error: %s" % e)


class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    try:
        httpd = Server(("127.0.0.1", PORT), Handler)
    except OSError as e:
        print("Port %d is already in use (%s)." % (PORT, e))
        print("Stop the old server first, or run: set PORT=8766 && py -3 server.py")
        sys.exit(1)
    print("Steam Walker  ->  http://127.0.0.1:%d/" % PORT)
    print("Steam proxy    ->  http://127.0.0.1:%d/api/steam?url=..." % PORT)
    print("Ctrl+C to stop.")
    if "--open" in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open("http://127.0.0.1:%d/" % PORT)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
        sys.exit(0)
