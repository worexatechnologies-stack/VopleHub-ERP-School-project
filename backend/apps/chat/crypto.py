"""Transparent at-rest encryption for school chat data.

The API continues to exchange ordinary strings and bytes. Encryption is applied
only at the persistence and Redis channel-layer boundaries, so browser and
mobile clients keep the same payload contract.
"""
import base64
import hashlib
import hmac
import json

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder


TEXT_PREFIX = 'vhchat:v1:'
BINARY_PREFIX = b'vhchat:v1:'
JSON_PREFIX = 'vhchat-json:v1:'
EVENT_PREFIX = 'vhchat-event:v1:'


def _fernet(context: bytes = b'chat-storage-v1') -> Fernet:
    secret = settings.SECRET_KEY.encode('utf-8')
    digest = hmac.new(secret, b'volpehub-chat\0' + context, hashlib.sha256).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_text(value: str) -> str:
    if not value or value.startswith(TEXT_PREFIX):
        return value
    token = _fernet().encrypt(value.encode('utf-8')).decode('ascii')
    return TEXT_PREFIX + token


def decrypt_text(value: str) -> str:
    if not value or not value.startswith(TEXT_PREFIX):
        return value
    token = value[len(TEXT_PREFIX):]
    try:
        return _fernet().decrypt(token.encode('ascii')).decode('utf-8')
    except (InvalidToken, ValueError, UnicodeDecodeError) as exc:
        raise ValueError('Chat text could not be decrypted; check the configured Django secret key.') from exc


def encrypt_binary(value: bytes) -> bytes:
    if not value or value.startswith(BINARY_PREFIX):
        return value
    return BINARY_PREFIX + _fernet().encrypt(value)


def decrypt_binary(value: bytes) -> bytes:
    if not value or not value.startswith(BINARY_PREFIX):
        return value
    try:
        return _fernet().decrypt(value[len(BINARY_PREFIX):])
    except (InvalidToken, ValueError) as exc:
        raise ValueError('Chat attachment could not be decrypted; check the configured Django secret key.') from exc


def encrypt_json(value, *, context: bytes = b'chat-json-storage-v1', prefix: str = JSON_PREFIX) -> str:
    if isinstance(value, str) and value.startswith(prefix):
        return value
    serialized = json.dumps(value, cls=DjangoJSONEncoder, ensure_ascii=False, separators=(',', ':'))
    token = _fernet(context).encrypt(serialized.encode('utf-8')).decode('ascii')
    return prefix + token


def decrypt_json(value, *, context: bytes = b'chat-json-storage-v1', prefix: str = JSON_PREFIX):
    if not isinstance(value, str) or not value.startswith(prefix):
        return value
    try:
        serialized = _fernet(context).decrypt(value[len(prefix):].encode('ascii')).decode('utf-8')
        return json.loads(serialized)
    except (InvalidToken, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError('Chat event data could not be decrypted; check the configured Django secret key.') from exc
