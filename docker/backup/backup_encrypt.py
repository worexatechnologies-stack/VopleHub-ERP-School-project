#!/usr/bin/env python3
"""Streaming authenticated encryption for PostgreSQL custom-format backups."""
import hashlib
import hmac
import os
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


MAGIC = b'VHBKENC1'
NONCE_BYTES = 12
TAG_BYTES = 16
CHUNK_BYTES = 1024 * 1024


def _key() -> bytes:
    secret = os.environ.get('BACKUP_ENCRYPTION_KEY') or os.environ.get('DJANGO_SECRET_KEY')
    if not secret:
        raise RuntimeError('BACKUP_ENCRYPTION_KEY or DJANGO_SECRET_KEY must be configured.')
    return hmac.new(secret.encode('utf-8'), b'volpehub-postgres-backup-v1', hashlib.sha256).digest()


def encrypt(source, destination) -> None:
    nonce = os.urandom(NONCE_BYTES)
    encryptor = Cipher(algorithms.AES(_key()), modes.GCM(nonce)).encryptor()
    destination.write(MAGIC + nonce)
    while True:
        chunk = source.read(CHUNK_BYTES)
        if not chunk:
            break
        destination.write(encryptor.update(chunk))
    destination.write(encryptor.finalize())
    destination.write(encryptor.tag)


def decrypt(source, destination) -> None:
    header = source.read(len(MAGIC))
    if header != MAGIC:
        # Allow restoring legacy unencrypted pg_dump archives.
        destination.write(header)
        while True:
            chunk = source.read(CHUNK_BYTES)
            if not chunk:
                break
            destination.write(chunk)
        return

    nonce = source.read(NONCE_BYTES)
    if len(nonce) != NONCE_BYTES:
        raise ValueError('Encrypted backup has an incomplete header.')
    decryptor = Cipher(algorithms.AES(_key()), modes.GCM(nonce)).decryptor()
    pending = b''
    while True:
        chunk = source.read(CHUNK_BYTES)
        if not chunk:
            break
        chunk = pending + chunk
        if len(chunk) <= TAG_BYTES:
            pending = chunk
            continue
        ciphertext, pending = chunk[:-TAG_BYTES], chunk[-TAG_BYTES:]
        destination.write(decryptor.update(ciphertext))

    if len(pending) != TAG_BYTES:
        raise ValueError('Encrypted backup has no complete authentication tag.')
    destination.write(decryptor.finalize_with_tag(pending))


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in {'encrypt', 'decrypt'}:
        print('Usage: backup_encrypt.py {encrypt|decrypt}', file=sys.stderr)
        return 2
    try:
        operation = encrypt if sys.argv[1] == 'encrypt' else decrypt
        operation(sys.stdin.buffer, sys.stdout.buffer)
        sys.stdout.buffer.flush()
    except BrokenPipeError:
        # Standard Unix behavior: downstream consumer (e.g., pg_restore --list) exited early.
        try:
            sys.stdout.close()
        except Exception:
            pass
        return 0
    except Exception as exc:
        print(f'Backup cryptographic operation failed: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
