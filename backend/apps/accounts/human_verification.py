import json
import logging
import sys
import urllib.parse
import urllib.request
from typing import Optional, Tuple
from urllib.parse import urlsplit

from django.conf import settings

from apps.accounts.auth_utils import _client_ip

logger = logging.getLogger(__name__)


def _valid_turnstile_login_response(result: dict, request) -> bool:
    """Accept only a successful Turnstile token minted for this login action and host."""
    if not isinstance(result, dict) or result.get('success') is not True:
        return False

    expected_hostname = (urlsplit(f"//{request.get_host()}").hostname or '').rstrip('.').lower()
    token_hostname = str(result.get('hostname') or '').rstrip('.').lower()
    return bool(
        expected_hostname
        and token_hostname == expected_hostname
        and result.get('action') == 'login'
    )


def verify_human_token(token_str: Optional[str], request) -> Tuple[bool, Optional[str]]:
    """Require Cloudflare Turnstile for browser logins; test mode bypasses external verification."""
    if getattr(settings, 'TESTING', False) or 'test' in sys.argv:
        return True, None

    if not token_str or not isinstance(token_str, str):
        return False, 'Please complete the Cloudflare security check to sign in.'

    secret = str(getattr(settings, 'CLOUDFLARE_TURNSTILE_SECRET_KEY', '') or '').strip()
    if not secret:
        logger.error('Turnstile login blocked because the server secret is not configured')
        return False, 'Cloudflare verification is unavailable. Please contact support.'

    try:
        client_ip = _client_ip(request)
        data = urllib.parse.urlencode({
            'secret': secret,
            'response': token_str.strip(),
            'remoteip': client_ip or '',
        }).encode('utf-8')

        req = urllib.request.Request(
            'https://challenges.cloudflare.com/turnstile/v0/siteverify',
            data=data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            result = json.loads(response.read().decode('utf-8'))
        if _valid_turnstile_login_response(result, request):
            return True, None

        logger.warning(
            'Cloudflare Turnstile verification failed with error codes: %s',
            result.get('error-codes', []) if isinstance(result, dict) else 'invalid response',
        )
    except Exception as exc:
        logger.error('Error verifying Cloudflare Turnstile token: %s', exc)

    return False, 'Cloudflare verification failed. Please complete the check again.'
