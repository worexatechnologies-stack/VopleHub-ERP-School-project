"""Request-level security, tenant RLS isolation, and performance monitoring middleware."""
import logging
import time
from django.db import connection
from django.http import JsonResponse
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from apps.accounts.authentication import CachedJWTAuthentication

logger = logging.getLogger('apps.performance')

PASSWORD_CHANGE_PATHS = {
    '/api/v1/auth/change-password/',
    '/api/v1/auth/logout/',
}


class PerformanceMonitoringMiddleware:
    """Monitors API response times and database query counts per request.

    Attaches X-Response-Time-Ms and X-Query-Count headers to all API responses,
    and logs actionable warnings when queries exceed thresholds.
    """
    SLOW_REQUEST_THRESHOLD_MS = 500.0  # Alert if request > 500ms
    HIGH_QUERY_THRESHOLD = 25          # Alert if > 25 DB queries (potential N+1)

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        queries_executed = 0

        def query_counter(execute, sql, params, many, context):
            nonlocal queries_executed
            queries_executed += 1
            return execute(sql, params, many, context)

        start_time = time.perf_counter()

        with connection.execute_wrapper(query_counter):
            response = self.get_response(request)

        duration_ms = (time.perf_counter() - start_time) * 1000.0

        # Inject metrics headers
        response['X-Response-Time-Ms'] = f"{duration_ms:.2f}"
        response['X-Query-Count'] = str(queries_executed)

        # Performance alerts for diagnostics
        if duration_ms > self.SLOW_REQUEST_THRESHOLD_MS:
            logger.warning(
                f"[PERF_ALERT:SLOW_REQUEST] {request.method} {request.path} took {duration_ms:.2f}ms "
                f"with {queries_executed} queries (user={getattr(request.user, 'pk', 'anon')})"
            )
        if queries_executed > self.HIGH_QUERY_THRESHOLD:
            logger.warning(
                f"[PERF_ALERT:HIGH_QUERIES] {request.method} {request.path} executed {queries_executed} queries "
                f"in {duration_ms:.2f}ms (potential N+1 leak)"
            )

        return response


class JwtTenantSecurityMiddleware:
    """Authenticate bearer tokens early, enforce temporary-password state, and set RLS context.

    Uses session-scoped SET with guaranteed finally-block RESET to eliminate transaction starvation
    and avoid holding long-running PostgreSQL transactions open during network I/O.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.jwt_authentication = CachedJWTAuthentication()

    def _authenticated_user(self, request):
        if getattr(request, '_cached_jwt_auth', None):
            return request._cached_jwt_auth[0]
        if getattr(request.user, 'is_authenticated', False):
            return request.user
        try:
            authenticated = self.jwt_authentication.authenticate(request)
        except AuthenticationFailed:
            return None
        if authenticated is None:
            return None
        user, _token = authenticated
        request.user = user
        request._cached_jwt_auth = (user, _token)
        return user

    def __call__(self, request):
        user = self._authenticated_user(request)
        if user and user.must_change_password and request.path not in PASSWORD_CHANGE_PATHS:
            return JsonResponse(
                {'detail': 'You must change your temporary password before continuing.'},
                status=403,
            )

        if not user or connection.vendor != 'postgresql':
            return self.get_response(request)

        tenant_set = False

        def lazy_tenant_wrapper(execute, sql, params, many, context):
            nonlocal tenant_set
            if not tenant_set:
                tenant_set = True
                with connection.cursor() as cursor:
                    cursor.execute(
                        'SET app.school_id = %s; SET app.is_superadmin = %s;',
                        [str(user.school_id or ''), 'true' if user.role == 'super_admin' else 'false'],
                    )
            return execute(sql, params, many, context)

        try:
            with connection.execute_wrapper(lazy_tenant_wrapper):
                return self.get_response(request)
        finally:
            if tenant_set and connection.vendor == 'postgresql' and connection.connection is not None:
                try:
                    with connection.cursor() as cursor:
                        cursor.execute('RESET app.school_id; RESET app.is_superadmin;')
                except Exception:
                    pass
