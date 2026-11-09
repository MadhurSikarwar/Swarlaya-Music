"""A small S3 client for the Audio Lab's file store (Backblaze B2's S3-compatible API), standard library only.

Every request is a presigned URL (AWS Signature Version 4, query authentication), so the same signer
makes the links the browser uploads to, plays from and downloads from — no credential ever leaves the
server — and the calls the server makes itself (download an input, upload a result, list, delete, CORS).
The function bundle is large already, so this is ~150 lines instead of boto3.

Settings (environment): B2_ENDPOINT (e.g. s3.us-west-004.backblazeb2.com), B2_BUCKET, B2_KEY_ID,
B2_APPLICATION_KEY. The region is the endpoint's second label (us-west-004).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional

UNSIGNED = "UNSIGNED-PAYLOAD"
_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"


def _quote(s: str, safe: str = "-_.~") -> str:
    return urllib.parse.quote(s, safe=safe)


def presign(method: str, host: str, path: str, region: str, key_id: str, secret: str, expires: int = 3600,
            query: Optional[dict] = None, now: Optional[datetime] = None, service: str = "s3") -> str:
    """A SigV4 query-authenticated URL (only the host header is signed; the payload is unsigned)."""
    now = now or datetime.now(timezone.utc)
    stamp, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    scope = f"{day}/{region}/{service}/aws4_request"
    params = dict(query or {})
    params.update({"X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": f"{key_id}/{scope}",
                   "X-Amz-Date": stamp, "X-Amz-Expires": str(int(expires)), "X-Amz-SignedHeaders": "host"})
    canonical_query = "&".join(f"{_quote(k)}={_quote(str(v))}" for k, v in sorted(params.items()))
    canonical_path = _quote(path, safe="/-_.~")
    canonical = "\n".join([method, canonical_path, canonical_query, f"host:{host}\n", "host", UNSIGNED])
    to_sign = "\n".join(["AWS4-HMAC-SHA256", stamp, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    k = hmac.new(f"AWS4{secret}".encode(), day.encode(), hashlib.sha256).digest()
    for part in (region, service, "aws4_request"):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    return f"https://{host}{canonical_path}?{canonical_query}&X-Amz-Signature={signature}"


@dataclass
class Item:
    key: str
    size: int
    modified: datetime


class StoreError(RuntimeError):
    def __init__(self, status: int, body: str):
        code = re.search(r"<Code>([^<]+)</Code>", body or "")
        message = re.search(r"<Message>([^<]+)</Message>", body or "")
        super().__init__(f"S3 {status} {code.group(1) if code else ''}: {message.group(1) if message else (body or '')[:200]}")
        self.status, self.code = status, code.group(1) if code else ""


@dataclass
class Store:
    endpoint: str
    bucket: str
    key_id: str
    secret: str
    timeout: float = 120.0

    @classmethod
    def from_env(cls) -> Optional["Store"]:
        e = {k: os.environ.get(k, "").strip() for k in ("B2_ENDPOINT", "B2_BUCKET", "B2_KEY_ID", "B2_APPLICATION_KEY")}
        if not all(e.values()):
            return None
        host = re.sub(r"^https?://", "", e["B2_ENDPOINT"]).strip("/")
        return cls(host, e["B2_BUCKET"], e["B2_KEY_ID"], e["B2_APPLICATION_KEY"])

    @property
    def region(self) -> str:
        parts = self.endpoint.split(".")
        return parts[1] if len(parts) > 2 and parts[0] == "s3" else "us-east-1"

    def url(self, method: str, key: str = "", expires: int = 3600, query: Optional[dict] = None) -> str:
        path = f"/{self.bucket}/{key}" if key else f"/{self.bucket}"
        return presign(method, self.endpoint, path, self.region, self.key_id, self.secret, expires, query)

    def _call(self, method: str, key: str = "", query: Optional[dict] = None, data=None, headers=None):
        req = urllib.request.Request(self.url(method, key, 900, query), data=data, method=method, headers=headers or {})
        try:
            return urllib.request.urlopen(req, timeout=self.timeout)
        except urllib.error.HTTPError as e:
            raise StoreError(e.code, e.read().decode("utf-8", "replace")) from None

    # ── links for the browser ─────────────────────────────────────────────────
    def upload_url(self, key: str, expires: int = 3600) -> str:
        return self.url("PUT", key, expires)

    def get_url(self, key: str, expires: int, download_name: Optional[str] = None) -> str:
        q = {"response-content-disposition": f'attachment; filename="{download_name}"'} if download_name else None
        return self.url("GET", key, expires, q)

    # ── the server's own calls ────────────────────────────────────────────────
    def put_file(self, key: str, path: Path, content_type: str) -> None:
        size = path.stat().st_size
        with path.open("rb") as f:
            self._call("PUT", key, data=f, headers={"Content-Type": content_type, "Content-Length": str(size)}).close()

    def open(self, key: str):
        """The object's body, as a file-like response (close it)."""
        return self._call("GET", key)

    def delete(self, key: str) -> None:
        try:
            self._call("DELETE", key).close()
        except StoreError as e:
            if e.status != 404:
                raise

    def list(self, prefix: str) -> Iterator[Item]:
        token = None
        while True:
            q = {"list-type": "2", "prefix": prefix, **({"continuation-token": token} if token else {})}
            with self._call("GET", query=q) as r:
                root = ET.fromstring(r.read())
            for c in root.iter(f"{_NS}Contents"):
                stamp = c.findtext(f"{_NS}LastModified").replace("Z", "+00:00")
                yield Item(c.findtext(f"{_NS}Key"), int(c.findtext(f"{_NS}Size") or 0), datetime.fromisoformat(stamp))
            if root.findtext(f"{_NS}IsTruncated") != "true":
                return
            token = root.findtext(f"{_NS}NextContinuationToken")

    def put_cors(self, origins: list) -> None:
        """Let the site's pages upload to, play from and download from the bucket."""
        rule = "".join(f"<AllowedOrigin>{o}</AllowedOrigin>" for o in origins)
        body = ("<CORSConfiguration><CORSRule>" + rule +
                "<AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>PUT</AllowedMethod>"
                "<AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds>"
                "</CORSRule></CORSConfiguration>").encode()
        md5 = base64.b64encode(hashlib.md5(body).digest()).decode()
        self._call("PUT", query={"cors": ""}, data=body,
                   headers={"Content-Type": "application/xml", "Content-MD5": md5}).close()
