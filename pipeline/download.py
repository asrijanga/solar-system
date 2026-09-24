"""Checksummed, resumable, retrying downloads into pipeline/.cache.

Every source file is pinned by SHA-256. Where the publisher also gives an MD5 (USGS does),
it is checked too, so the first download of a new source is verified against the
publisher rather than only against itself. A download that does not match is discarded and
retried from scratch; it is never used. Cached files are re-verified on every run.
"""

from __future__ import annotations

import hashlib
import time
import urllib.request
from pathlib import Path

CACHE = Path(__file__).resolve().parent / ".cache"
ATTEMPTS = 6
CHUNK = 1 << 20
# Identify ourselves. planetarymaps.usgs.gov answers 403 to Python's default "Python-urllib".
USER_AGENT = "solar-system-pipeline/0 (+https://github.com/asrijanga/solar-system)"


def digest(path: Path, algorithm: str) -> str:
    h = hashlib.new(algorithm)
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256(path: Path) -> str:
    return digest(path, "sha256")


def _verified(path: Path, sha: str | None, md5: str | None) -> tuple[bool, str]:
    if md5 is not None:
        actual = digest(path, "md5")
        if actual != md5:
            return False, f"md5 mismatch: got {actual}, publisher says {md5}"
    if sha is not None:
        actual = sha256(path)
        if actual != sha:
            return False, f"sha256 mismatch: got {actual}"
    return True, ""


def fetch(url: str, expected_sha256: str | None, name: str, *, md5: str | None = None) -> Path:
    """Returns a verified local copy of `url`, resuming a partial download if one exists.

    `expected_sha256` may be None only for a first download that has a publisher MD5; the
    caller must then pin the SHA-256 this prints.
    """
    if expected_sha256 is None and md5 is None:
        raise ValueError(f"{name}: refusing an unpinned download with no publisher checksum")
    CACHE.mkdir(exist_ok=True)
    target = CACHE / name
    if target.exists():
        ok, _ = _verified(target, expected_sha256, md5)
        if ok:
            return target
        target.unlink()

    partial = target.with_suffix(target.suffix + ".partial")
    last_error = "no attempt made"
    for attempt in range(1, ATTEMPTS + 1):
        try:
            have = partial.stat().st_size if partial.exists() else 0
            headers = {"User-Agent": USER_AGENT}
            if have:
                headers["Range"] = f"bytes={have}-"
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=120) as response:
                resumed = have > 0 and response.status == 206
                length = response.headers.get("Content-Length")
                total = (have if resumed else 0) + int(length) if length is not None else None
                with partial.open("ab" if resumed else "wb") as out:
                    while chunk := response.read(CHUNK):
                        out.write(chunk)
            size = partial.stat().st_size
            if total is not None and size < total:
                # The connection ended early without an error: keep what arrived and resume.
                raise OSError(f"transfer ended early at {size} of {total} bytes")
            ok, why = _verified(partial, expected_sha256, md5)
            if ok:
                partial.replace(target)
                if expected_sha256 is None:
                    print(f"  {name}: verified against publisher md5; pin sha256 {sha256(target)}")
                return target
            last_error = why
            partial.unlink()  # a complete but wrong file: start again
        except OSError as error:  # network errors, truncated transfers: resume next time
            last_error = str(error)
        print(f"  download attempt {attempt} of {url} failed: {last_error}", flush=True)
        time.sleep(min(2**attempt, 30))
    raise RuntimeError(f"could not download {url}: {last_error}")
