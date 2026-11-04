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

CLOUDFLARE_TEST_SECRET = '1x0000000000000000000000000000000AA'


def _valid_turnstile_login_response(result: dict, request) -> bool:
    """Accept only a successful Turnstile token minted for this login action and host."""
    if not isinstance(result, dict) or result.get('success') is not True:
        return False

    expected_hostname = (urlsplit(f"//{request.get_host()}").hostname or '').rstrip('.').lower()
    token_hostname = str(result.get('hostname') or '').rstrip('.').lower()

    is_local_host = expected_hostname in ('localhost', '127.0.0.1', 'testserver') or expected_hostname.startswith('192.168.')
    is_dev = getattr(settings, 'DEBUG', False) or is_local_host

    if is_dev:
        # In local development, accept any successful Turnstile token (Cloudflare test keys return
        # hostname 'example.com' and omit the action field, or developers may test with custom keys).
        return True

    # Strict production validation: must match exact production hostname and 'login' action
    return bool(
        expected_hostname
        and token_hostname == expected_hostname
        and result.get('action') == 'login'
    )


def verify_human_token(token_str: Optional[str], request) -> Tuple[bool, Optional[str]]:
    """Require Cloudflare Turnstile for browser logins; test mode bypasses external verification."""
    if getattr(settings, 'TESTING', False) or 'test' in sys.argv:
        return True, None

    # Local development bypass token for offline dev or automated local testing
    if getattr(settings, 'DEBUG', False) and token_str == 'dev-bypass-token':
        logger.info('Accepted dev-bypass-token in DEBUG mode')
        return True, None

    if not token_str or not isinstance(token_str, str):
        return False, 'Please complete the Cloudflare security check to sign in.'

    secret = str(getattr(settings, 'CLOUDFLARE_TURNSTILE_SECRET_KEY', '') or '').strip()
    if getattr(settings, 'DEBUG', False) and not secret:
        secret = CLOUDFLARE_TEST_SECRET

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
