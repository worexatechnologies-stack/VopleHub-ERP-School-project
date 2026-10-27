"""WebSocket authentication middleware supporting session cookies and SimpleJWT tokens."""
import logging
import time
from http.cookies import SimpleCookie
from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from django.contrib.sessions.backends.cached_db import SessionStore
from rest_framework_simplejwt.tokens import AccessToken
from apps.accounts.authentication import get_cached_user

logger = logging.getLogger(__name__)


@database_sync_to_async
def get_user_from_session(session_key: str):
    if not session_key:
        return AnonymousUser(), None
    try:
        session = SessionStore(session_key=session_key)
        user_id = session.get('_auth_user_id')
        if not user_id:
            return AnonymousUser(), None
        now = time.time()
        created_at = session.get('_auth_session_created_at')
        last_activity_at = session.get('_auth_session_last_activity_at')
        if created_at is None or last_activity_at is None:
            return AnonymousUser(), None
        if (
            now - float(last_activity_at) >= settings.SESSION_IDLE_TIMEOUT_SECONDS
            or now - float(created_at) >= settings.SESSION_ABSOLUTE_TIMEOUT_SECONDS
        ):
            session.delete()
            return AnonymousUser(), None
        user = get_cached_user(user_id)
        if user and user.is_active:
            return user, {'session_key': session_key, 'created_at': float(created_at)}
        return AnonymousUser(), None
    except Exception as exc:
        logger.debug('WebSocket session auth failed: %s', exc)
        return AnonymousUser(), None


@database_sync_to_async
def django_session_is_active(session_key: str, user_id: str) -> bool:
    """Check idle and fixed expiry without extending the session lifetime."""
    try:
        session = SessionStore(session_key=session_key)
        if not session.exists(session_key) or str(session.get('_auth_user_id')) != str(user_id):
            return False
        now = time.time()
        created_at = float(session.get('_auth_session_created_at'))
        last_activity_at = float(session.get('_auth_session_last_activity_at'))
        if (
            now - last_activity_at >= settings.SESSION_IDLE_TIMEOUT_SECONDS
            or now - created_at >= settings.SESSION_ABSOLUTE_TIMEOUT_SECONDS
        ):
            session.delete()
            return False
        return True
    except (KeyError, TypeError, ValueError):
        return False


@database_sync_to_async
def touch_django_session(session_key: str, user_id: str) -> bool:
    """Keep active WebSocket sessions idle-alive, while enforcing absolute expiry."""
    try:
        session = SessionStore(session_key=session_key)
        if not session.exists(session_key) or str(session.get('_auth_user_id')) != str(user_id):
            return False
        now = time.time()
        created_at = float(session.get('_auth_session_created_at'))
        last_activity_at = float(session.get('_auth_session_last_activity_at'))
        if (
            now - last_activity_at >= settings.SESSION_IDLE_TIMEOUT_SECONDS
            or now - created_at >= settings.SESSION_ABSOLUTE_TIMEOUT_SECONDS
        ):
            session.delete()
            return False
        session['_auth_session_last_activity_at'] = now
        session.set_expiry(settings.SESSION_IDLE_TIMEOUT_SECONDS)
        session.save()
        return True
    except (KeyError, TypeError, ValueError):
        return False


@database_sync_to_async
def get_user_from_token(token_string: str):
    if not token_string:
        return AnonymousUser()
    try:
        access_token = AccessToken(token_string)
        user_id = access_token.get('user_id')
        if not user_id:
            return AnonymousUser()
        user = get_cached_user(user_id)
        if user and user.is_active:
            return user
        return AnonymousUser()
    except Exception as exc:
        logger.debug('WebSocket JWT auth failed: %s', exc)
        return AnonymousUser()


class JwtAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        headers = dict(scope.get('headers', []))

        # Browser clients authenticate with the server-side Django session.
        cookie_header = headers.get(b'cookie', b'').decode('utf-8')
        if cookie_header:
            cookies = SimpleCookie()
            cookies.load(cookie_header)
            session_cookie = cookies.get(settings.SESSION_COOKIE_NAME)
            if session_cookie and session_cookie.value:
                user, session_auth = await get_user_from_session(session_cookie.value)
                if user and user.is_authenticated:
                    scope['user'] = user
                    scope['django_session_auth'] = session_auth
                    return await super().__call__(scope, receive, send)

        # Never accept JWTs in the URL: URLs can be retained in proxy/access logs.
        # Native clients can use Authorization; browsers use the session cookie above.
        token = None
        auth_header = headers.get(b'authorization', b'').decode('utf-8')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:].strip()

        # 3. Authenticate with token or set AnonymousUser
        if token:
            scope['user'] = await get_user_from_token(token)
        else:
            scope['user'] = AnonymousUser()

        return await super().__call__(scope, receive, send)


def JwtAuthMiddlewareStack(inner):
    return JwtAuthMiddleware(inner)
