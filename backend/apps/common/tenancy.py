"""Tenant-safe queryset helpers.

All school-owned DRF resources should inherit ``TenantScopedViewSet``.  It
returns an empty queryset for users without a school instead of accidentally
falling back to a global queryset.
"""
from contextlib import contextmanager
from functools import wraps

from django.db import connection, transaction
from rest_framework import viewsets

from apps.accounts.models import User


@contextmanager
def tenant_rls_context(school_id=None, *, is_superadmin=False):
    """Run database work with transaction-local PostgreSQL row-security context."""
    if connection.vendor != 'postgresql':
        yield
        return

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT set_config('app.school_id', %s, true)",
                [str(school_id or '')],
            )
            cursor.execute(
                "SELECT set_config('app.is_superadmin', %s, true)",
                ['true' if is_superadmin else 'false'],
            )
        yield


def with_superadmin_rls_context(function):
    """Mark trusted maintenance commands as explicit database-wide operators."""
    @wraps(function)
    def wrapped(*args, **kwargs):
        with tenant_rls_context(is_superadmin=True):
            return function(*args, **kwargs)
    return wrapped


class TenantScopedViewSet(viewsets.ModelViewSet):
    """Scope a model with a direct ``school`` foreign key to the current tenant."""

    school_field = 'school'

    def get_tenant_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return self.queryset.none()
        user = self.request.user
        if not user.is_authenticated:
            return self.queryset.none()
        if user.role == User.Role.SUPER_ADMIN:
            return self.queryset.all()
        if not user.school_id:
            return self.queryset.none()
        return self.queryset.filter(**{f'{self.school_field}_id': user.school_id})

    def get_queryset(self):
        return self.get_tenant_queryset()
