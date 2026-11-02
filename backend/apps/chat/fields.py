"""ORM fields that encrypt chat contents while preserving the API data shape."""
from django.db import models

from .crypto import (
    JSON_PREFIX,
    decrypt_binary,
    decrypt_json,
    decrypt_text,
    encrypt_binary,
    encrypt_json,
    encrypt_text,
)


class EncryptedChatTextField(models.TextField):
    def from_db_value(self, value, expression, connection):
        return decrypt_text(value)

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        return encrypt_text(value) if value is not None else None


class EncryptedChatBinaryField(models.BinaryField):
    def from_db_value(self, value, expression, connection):
        if value is None:
            return None
        if isinstance(value, memoryview):
            value = value.tobytes()
        return decrypt_binary(bytes(value))

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if value is None:
            return None
        if isinstance(value, memoryview):
            value = value.tobytes()
        return encrypt_binary(bytes(value))


class EncryptedChatJSONField(models.JSONField):
    """Encrypted JSONField; existing JSON rows remain readable during migration."""

    def from_db_value(self, value, expression, connection):
        # JSON backends return the stored JSON scalar as a quoted JSON string,
        # while SQLite may already provide the decoded string. Normalize first
        # so encrypted payloads are detected consistently on both backends.
        value = super().from_db_value(value, expression, connection)
        if isinstance(value, str) and value.startswith(JSON_PREFIX):
            return decrypt_json(value)
        return value

    def get_prep_value(self, value):
        if value is None:
            return None
        return encrypt_json(value)
