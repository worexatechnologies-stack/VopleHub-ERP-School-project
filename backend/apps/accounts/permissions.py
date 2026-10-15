from rest_framework.permissions import BasePermission


class MustChangePasswordComplete(BasePermission):
    """Temporary accounts may only call the password-change endpoint."""
    def has_permission(self, request, view):
        user = request.user
        return not user.is_authenticated or not user.must_change_password or getattr(view, 'allows_password_change', False)
