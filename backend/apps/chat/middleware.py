"""WebSocket authentication middleware extracting and validating SimpleJWT tokens."""
import logging
from urllib.parse import parse_qs
from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.tokens import AccessToken
from apps.accounts.authentication import get_cached_user

logger = logging.getLogger(__name__)


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
        token = None

        # 1. Parse token from query string (?token=...)
        query_string = scope.get('query_string', b'').decode('utf-8')
        if query_string:
            params = parse_qs(query_string)
            token_list = params.get('token') or params.get('access_token')
            if token_list:
                token = token_list[0]

        # 2. Parse from headers (Authorization: Bearer ...)
        if not token:
            headers = dict(scope.get('headers', []))
            auth_header = headers.get(b'authorization', b'').decode('utf-8')
            if auth_header.startswith('Bearer '):
                token = auth_header[7:].strip()

        # 3. Authenticate
        scope['user'] = await get_user_from_token(token)
        return await super().__call__(scope, receive, send)


def JwtAuthMiddlewareStack(inner):
    return JwtAuthMiddleware(inner)
