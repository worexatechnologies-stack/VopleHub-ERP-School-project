#!/usr/bin/env python3
"""Atomically update the Turnstile secret in the production backend env file.

The secret is read only from stdin so it does not appear in a command argument
or in this script. This helper deliberately never prints the secret.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path


BACKEND_ENV_PATH = Path("/opt/volpehub/backend/.env")
ROOT_ENV_PATH = Path("/opt/volpehub/.env")
KEY_PREFIX = b"CLOUDFLARE_TURNSTILE_SECRET_KEY="


def update_env_file(env_path: Path, secret: bytes) -> None:
    original = env_path.read_bytes() if env_path.exists() else b""
    kept_lines = [
        line
        for line in original.splitlines(keepends=True)
        if not line.startswith(KEY_PREFIX)
    ]
    updated = b"".join(kept_lines)
    if updated and not updated.endswith((b"\n", b"\r")):
        updated += b"\n"
    updated += KEY_PREFIX + secret + b"\n"

    fd, temporary_path = tempfile.mkstemp(prefix=".turnstile-env-", dir=env_path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as temporary_file:
            temporary_file.write(updated)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, env_path)
        directory_fd = os.open(env_path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
        raise


def main() -> int:
    secret = sys.stdin.buffer.read()
    # A pasted Actions secret can accidentally include surrounding whitespace.
    # Remove it at the edges; reject any whitespace that remains inside.
    secret = secret.strip()
    if not secret or not secret.isascii() or not all(33 <= byte <= 126 for byte in secret):
        print("Turnstile secret input is empty or contains invalid characters.", file=sys.stderr)
        return 1

    if not BACKEND_ENV_PATH.parent.is_dir():
        print("Production backend environment directory does not exist.", file=sys.stderr)
        return 1

    update_env_file(BACKEND_ENV_PATH, secret)
    # Compose loads the backend env first and the root env second. Keep the
    # secret in sync in both files when both production env files are present.
    if ROOT_ENV_PATH.exists():
        update_env_file(ROOT_ENV_PATH, secret)

    print("Turnstile secret updated in the production environment file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
