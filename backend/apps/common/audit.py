from .models import AdminAuditEvent


def record_admin_audit_event(request, action, *, target=None, school=None, metadata=None):
    """Write a minimal audit event; never pass secrets or credential values."""
    actor = getattr(request, 'user', None)
    if not actor or not actor.is_authenticated or actor.role not in {'school_admin', 'super_admin'}:
        return None
    if school is None and actor.role == 'school_admin':
        school = getattr(actor, 'school', None)
    remote_addr = request.META.get('REMOTE_ADDR')
    if remote_addr:
        import ipaddress
        try:
            remote_addr = str(ipaddress.ip_address(remote_addr))
        except ValueError:
            remote_addr = None
    safe_metadata = metadata if isinstance(metadata, dict) else {}
    return AdminAuditEvent.objects.create(
        actor=actor,
        school=school,
        action=str(action)[:80],
        object_type=target.__class__.__name__[:80] if target is not None else '',
        object_id=str(getattr(target, 'pk', '') or '')[:120],
        metadata=safe_metadata,
        remote_addr=remote_addr,
    )
