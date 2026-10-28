import hashlib
import hmac
import logging
import secrets
import sys
import time
from typing import Tuple, Optional

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from apps.accounts.auth_utils import _client_ip

logger = logging.getLogger(__name__)

CHALLENGE_VALIDITY_SECONDS = 300  # 5 minutes


def generate_challenge_token(request) -> dict:
    """Generate a tamper-proof cryptographic human verification challenge."""
    nonce = secrets.token_hex(16)
    timestamp = int(timezone.now().timestamp())
    client_ip = _client_ip(request) or '127.0.0.1'

    # HMAC signature bound to server secret, nonce, timestamp, and client IP
    payload = f"{nonce}:{timestamp}:{client_ip}"
    signature = hmac.new(
        settings.SECRET_KEY.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()

    token = f"vhs_{nonce}_{timestamp}_{signature}"
    return {
        'token': token,
        'timestamp': timestamp,
    }


def verify_human_token(token_str: Optional[str], request) -> Tuple[bool, Optional[str]]:
    """Validate a human verification token from either VolpeHub Shield or Cloudflare Turnstile."""
    if getattr(settings, 'TESTING', False) or 'test' in sys.argv:
        return True, None

    if not token_str or not isinstance(token_str, str):
        return False, "Please complete human verification to sign in."

    clean_token = token_str.strip()

    # 1. Cloudflare Turnstile Token Verification
    cf_secret = getattr(settings, 'CLOUDFLARE_TURNSTILE_SECRET_KEY', None)
    if cf_secret and (clean_token.startswith('0.') or len(clean_token) > 100):
        try:
            import urllib.request
            import urllib.parse
            import json

            client_ip = _client_ip(request)
            data = urllib.parse.urlencode({
                'secret': cf_secret,
                'response': clean_token,
                'remoteip': client_ip or '',
            }).encode('utf-8')

            req = urllib.request.Request(
                'https://challenges.cloudflare.com/turnstile/v0/siteverify',
                data=data,
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                result = json.loads(response.read().decode('utf-8'))
                if result.get('success'):
                    return True, None
                logger.warning('Cloudflare Turnstile verification failed: %s', result)
        except Exception as exc:
            logger.error('Error verifying Cloudflare Turnstile token: %s', exc)

    # 2. VolpeHub Shield Cryptographic Verification
    if clean_token.startswith('vhs_'):
        parts = clean_token.split('_')
        if len(parts) != 4:
            return False, "Malformed verification token. Please verify again."

        _prefix, nonce, timestamp_str, signature = parts

        try:
            timestamp = int(timestamp_str)
        except ValueError:
            return False, "Invalid verification token format."

        # Check timestamp freshness (must be within 5 minutes)
        now = int(timezone.now().timestamp())
        if now - timestamp > CHALLENGE_VALIDITY_SECONDS or timestamp > (now + 60):
            return False, "Verification challenge has expired. Please verify again."

        # Prevent replay attacks: each nonce may only be used once
        cache_key = f"vhs:used:{nonce}"
        if cache.get(cache_key):
            return False, "This verification token has already been used. Please verify again."

        # Verify cryptographic signature
        client_ip = _client_ip(request) or '127.0.0.1'
        expected_payload_ip = f"{nonce}:{timestamp}:{client_ip}"
        expected_sig_ip = hmac.new(
            settings.SECRET_KEY.encode('utf-8'),
            expected_payload_ip.encode('utf-8'),
            hashlib.sha256,
        ).hexdigest()

        # Fallback signature without IP to tolerate NAT / cellular proxy shifts
        expected_payload_fallback = f"{nonce}:{timestamp}"
        expected_sig_fallback = hmac.new(
            settings.SECRET_KEY.encode('utf-8'),
            expected_payload_fallback.encode('utf-8'),
            hashlib.sha256,
        ).hexdigest()

        is_valid_sig = (
            hmac.compare_digest(signature, expected_sig_ip)
            or hmac.compare_digest(signature, expected_sig_fallback)
        )

        if not is_valid_sig:
            logger.warning('Invalid human verification signature from IP %s', client_ip)
            return False, "Human verification check failed. Please try again."

        # Mark nonce as used for 6 minutes (TTL > validity period)
        cache.set(cache_key, True, timeout=CHALLENGE_VALIDITY_SECONDS + 60)
        return True, None

    return False, "Please complete human verification to sign in."
