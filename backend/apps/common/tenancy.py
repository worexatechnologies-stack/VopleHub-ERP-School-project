"""Tenant-safe queryset helpers.

All school-owned DRF resources should inherit ``TenantScopedViewSet``.  It
returns an empty queryset for users without a school instead of accidentally
falling back to a global queryset.
"""
from rest_framework import viewsets

from apps.accounts.models import User


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
