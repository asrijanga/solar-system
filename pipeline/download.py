"""Checksummed, retrying downloads into pipeline/.cache.

Every source file is pinned by SHA-256. A download that does not match is discarded and
retried; it is never used. Cached files are re-verified on every run.
"""

from __future__ import annotations

import hashlib
import time
import urllib.request
from pathlib import Path

CACHE = Path(__file__).resolve().parent / ".cache"
ATTEMPTS = 4


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(url: str, expected_sha256: str, name: str) -> Path:
    """Returns a verified local copy of `url`, downloading it if needed."""
    CACHE.mkdir(exist_ok=True)
    target = CACHE / name
    if target.exists() and sha256(target) == expected_sha256:
        return target

    partial = target.with_suffix(target.suffix + ".partial")
    last_error = "no attempt made"
    for attempt in range(1, ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(url, timeout=120) as response, partial.open("wb") as out:
                while chunk := response.read(1 << 16):
                    out.write(chunk)
            actual = sha256(partial)
            if actual == expected_sha256:
                partial.replace(target)
                return target
            last_error = f"checksum mismatch: got {actual}"
        except OSError as error:  # network errors, truncated transfers
            last_error = str(error)
        print(f"  download attempt {attempt} of {url} failed: {last_error}")
        time.sleep(2**attempt)
    partial.unlink(missing_ok=True)
    raise RuntimeError(f"could not download {url} with sha256 {expected_sha256}: {last_error}")
