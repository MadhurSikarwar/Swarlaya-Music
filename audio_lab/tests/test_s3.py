"""The S3 client (audio_lab/s3.py): its signatures, and the requests it makes, against a fake S3 server."""
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import pytest

from audio_lab import s3


def test_presigned_urls_match_the_aws_documentation_example():
    # "Authenticating Requests: Using Query Parameters (AWS Signature Version 4)", Amazon S3 API reference
    url = s3.presign("GET", "examplebucket.s3.amazonaws.com", "/test.txt", "us-east-1", "AKIAIOSFODNN7EXAMPLE",
                     "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", 86400, now=datetime(2013, 5, 24, tzinfo=timezone.utc))
    q = parse_qs(urlparse(url).query)
    assert q["X-Amz-Signature"] == ["aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"]
    assert q["X-Amz-Credential"] == ["AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request"]
    assert url.startswith("https://examplebucket.s3.amazonaws.com/test.txt?")


def test_settings_come_from_the_environment(monkeypatch):
    for k in ("B2_ENDPOINT", "B2_BUCKET", "B2_KEY_ID", "B2_APPLICATION_KEY"):
        monkeypatch.delenv(k, raising=False)
    assert s3.Store.from_env() is None
    monkeypatch.setenv("B2_ENDPOINT", "https://s3.us-west-004.backblazeb2.com/")
    monkeypatch.setenv("B2_BUCKET", "swaralaya")
    monkeypatch.setenv("B2_KEY_ID", "k")
    monkeypatch.setenv("B2_APPLICATION_KEY", "secret")
    store = s3.Store.from_env()
    assert store.endpoint == "s3.us-west-004.backblazeb2.com" and store.region == "us-west-004"
    url = store.get_url("audio-lab/j/out/r/x.mp3", 600, download_name="x.mp3")
    assert url.startswith("https://s3.us-west-004.backblazeb2.com/swaralaya/audio-lab/j/out/r/x.mp3?")
    assert "response-content-disposition=attachment%3B%20filename%3D%22x.mp3%22" in url
    assert "secret" not in url


class FakeS3(BaseHTTPRequestHandler):
    objects: dict = {}
    cors = None

    def log_message(self, *a):
        pass

    def _key(self):
        return urlparse(self.path).path.split("/", 2)[2] if urlparse(self.path).path.count("/") >= 2 else ""

    def do_PUT(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        if "cors" in parse_qs(urlparse(self.path).query, keep_blank_values=True):
            FakeS3.cors = (body, self.headers.get("Content-MD5"))
        else:
            FakeS3.objects[self._key()] = (body, self.headers.get("Content-Type"))
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        if q.get("list-type") == ["2"]:
            items = "".join(f"<Contents><Key>{k}</Key><LastModified>2026-11-09T10:00:00.000Z</LastModified>"
                            f"<Size>{len(v[0])}</Size></Contents>" for k, v in FakeS3.objects.items()
                            if k.startswith(q.get("prefix", [""])[0]))
            body = ('<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                    f"{items}<IsTruncated>false</IsTruncated></ListBucketResult>").encode()
        elif self._key() in FakeS3.objects:
            body = FakeS3.objects[self._key()][0]
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>")
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_DELETE(self):
        FakeS3.objects.pop(self._key(), None)
        self.send_response(204)
        self.end_headers()


@pytest.fixture()
def fake(monkeypatch):
    FakeS3.objects, FakeS3.cors = {}, None
    server = HTTPServer(("127.0.0.1", 0), FakeS3)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    store = s3.Store(f"127.0.0.1:{server.server_port}", "bucket", "key", "secret")
    real = s3.presign
    monkeypatch.setattr(s3, "presign", lambda *a, **k: real(*a, **k).replace("https://", "http://", 1))
    yield store
    server.shutdown()


def test_put_get_list_delete_and_cors(fake, tmp_path):
    f = tmp_path / "a.wav"
    f.write_bytes(b"RIFF....data")
    fake.put_file("audio-lab/j/out/r/a.wav", f, "audio/wav")
    assert FakeS3.objects["audio-lab/j/out/r/a.wav"] == (b"RIFF....data", "audio/wav")
    with fake.open("audio-lab/j/out/r/a.wav") as r:
        assert r.read() == b"RIFF....data"
    items = list(fake.list("audio-lab/"))
    assert [i.key for i in items] == ["audio-lab/j/out/r/a.wav"] and items[0].size == 12
    assert items[0].modified == datetime(2026, 11, 9, 10, tzinfo=timezone.utc)
    fake.delete("audio-lab/j/out/r/a.wav")
    fake.delete("audio-lab/j/out/r/a.wav")                           # already gone: fine
    assert not FakeS3.objects
    with pytest.raises(s3.StoreError) as e:
        fake.open("audio-lab/missing")
    assert e.value.status == 404 and e.value.code == "NoSuchKey"
    fake.put_cors(["https://swarlaya-music.vercel.app"])
    body, md5 = FakeS3.cors
    assert b"<AllowedOrigin>https://swarlaya-music.vercel.app</AllowedOrigin>" in body and b"PUT" in body and md5
