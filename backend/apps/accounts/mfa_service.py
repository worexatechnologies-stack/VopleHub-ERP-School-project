import logging
import secrets
import time
from django.conf import settings
from django.core.cache import cache
from apps.accounts.models import User

logger = logging.getLogger(__name__)

MFA_TTL = 300  # 5 minutes
MAX_ATTEMPTS = 5
RESEND_COOLDOWN = 30  # 30 seconds
DEV_OTP = '123456'


def _development_mfa_enabled() -> bool:
    """Return whether the explicitly selected settings profile permits dev OTPs.

    Django's test runner sets ``DEBUG=False`` for safety, which must not disable
    the development-only OTP flow.  Production settings explicitly set this
    flag to False; DEBUG alone is therefore never enough to enable it there.
    """
    return bool(getattr(settings, 'MFA_DEVELOPMENT_MODE', settings.DEBUG))


def is_mfa_configured() -> bool:
    """Return whether MFA is active and capable of dispatching verification codes."""
    if not getattr(settings, 'MFA_ENABLED', True):
        return False
    if _development_mfa_enabled():
        return True
    return bool(getattr(settings, 'EMAIL_HOST', '') and getattr(settings, 'DEFAULT_FROM_EMAIL', ''))


def is_mfa_delivery_configured() -> bool:
    """Whether OTP delivery is available, independent of optional MFA policy."""
    if _development_mfa_enabled():
        return True
    return bool(getattr(settings, 'EMAIL_HOST', '') and getattr(settings, 'DEFAULT_FROM_EMAIL', ''))


class MfaDeliveryError(Exception):
    """Raised when a production MFA code cannot be delivered."""


def get_user_contact_info(user: User) -> dict:
    """Retrieve available phone number and masked contact details for MFA delivery."""
    phone = ''
    try:
        if hasattr(user, 'teacher_profile') and user.teacher_profile:
            phone = user.teacher_profile.phone or ''
        elif hasattr(user, 'student_profile') and user.student_profile and user.student_profile.student:
            phone = user.student_profile.student.parent_phone or ''
        elif hasattr(user, 'parent_profile') and user.parent_profile:
            phone = user.parent_profile.phone or ''
    except Exception:
        pass

    masked_phone = ''
    if phone:
        digits_only = ''.join(c for c in phone if c.isdigit())
        if len(digits_only) >= 4:
            masked_phone = f"+91 ••••• ••{digits_only[-4:]}"
        else:
            masked_phone = "••••"

    masked_email = ''
    if user.email and '@' in user.email:
        local, domain = user.email.split('@', 1)
        if len(local) > 2:
            masked_email = f"{local[:2]}••••@{domain}"
        else:
            masked_email = f"••@{domain}"

    return {
        'phone': phone,
        'masked_phone': masked_phone,
        'masked_email': masked_email,
    }


def send_otp_notification(user: User, otp_code: str, contact_info: dict):
    """Deliver OTP through configured SMTP; expose it only in development."""
    if _development_mfa_enabled():
        logger.info('[MFA OTP] Development code for %s (role=%s): %s', user.email, user.role, otp_code)
        print(
            f"\n[MFA DEV OTP] {user.email} ({user.role}): {otp_code}\n",
            flush=True,
        )
        return

    recipient = str(user.email or '').strip()
    if not recipient or not settings.EMAIL_HOST or not settings.DEFAULT_FROM_EMAIL:
        raise MfaDeliveryError('Production MFA email is not configured for this account.')

    from django.core.mail import send_mail
    sent_count = send_mail(
        subject='Your Volpehub sign-in verification code',
        message=(
            f'Your Volpehub verification code is {otp_code}. '
            'It expires in 5 minutes. If you did not request this code, '
            'you can ignore this email.'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[recipient],
        fail_silently=False,
    )
    if sent_count != 1:
        raise MfaDeliveryError('The verification email was not accepted by the mail server.')


def create_mfa_challenge(user: User, request=None, requested_role: str = '') -> dict:
    """Create a new temporary multi-factor authentication challenge."""
    # NOTE: We intentionally do NOT delete the previous session here.
    # Aggressively deleting it causes login failure when the user reloads
    # the OTP page or double-clicks login, as the frontend holds the old
    # mfa_token which would then be gone. Let the MFA_TTL (5 min) expire naturally.
    mfa_token = secrets.token_urlsafe(32)
    otp_code = f"{secrets.randbelow(1000000):06d}"

    contact_info = get_user_contact_info(user)

    session_payload = {
        'user_id': user.id,
        'email': user.email,
        'role': user.role,
        'otp_code': otp_code,
        'attempts': 0,
        'created_at': time.time(),
        'resend_available_at': time.time() + RESEND_COOLDOWN,
        'requested_role': requested_role,
        'contact_info': contact_info,
    }

    cache.set(f"mfa_session:{mfa_token}", session_payload, timeout=MFA_TTL)
    cache.set(f"mfa_user:{user.id}", mfa_token, timeout=MFA_TTL)

    try:
        send_otp_notification(user, otp_code, contact_info)
    except Exception as exc:
        cache.delete(f"mfa_session:{mfa_token}")
        cache.delete(f"mfa_user:{user.id}")
        logger.warning('MFA code delivery failed for user_id=%s (DEBUG=%s): %s', user.id, settings.DEBUG, exc)
        raise MfaDeliveryError('MFA code delivery failed.') from exc

    return {
        'mfa_token': mfa_token,
        'masked_phone': contact_info['masked_phone'],
        'masked_email': contact_info['masked_email'],
        'dev_otp': otp_code if _development_mfa_enabled() else None,
    }


def verify_mfa_code(mfa_token: str, submitted_otp: str) -> dict:
    """Verify the submitted OTP against the session token.

    Accepts the generated OTP or the developer OTP (123456).
    """
    clean_token = str(mfa_token or '').strip()
    clean_otp = str(submitted_otp or '').strip()

    if not clean_token or not clean_otp:
        return {'success': False, 'error': 'MFA session token and verification code are required.'}

    session = cache.get(f"mfa_session:{clean_token}")
    if not session:
        return {'success': False, 'error': 'Verification session has expired or is invalid. Please sign in again.'}

    if session.get('attempts', 0) >= MAX_ATTEMPTS:
        cache.delete(f"mfa_session:{clean_token}")
        return {'success': False, 'error': 'Too many failed verification attempts. Please sign in again.'}

    actual_otp = session.get('otp_code', '')
    is_valid = clean_otp == actual_otp or (_development_mfa_enabled() and clean_otp == DEV_OTP)

    if not is_valid:
        session['attempts'] = session.get('attempts', 0) + 1
        remaining_time = max(1, int(MFA_TTL - (time.time() - session.get('created_at', time.time()))))
        cache.set(f"mfa_session:{clean_token}", session, timeout=remaining_time)
        remaining_attempts = MAX_ATTEMPTS - session['attempts']
        return {
            'success': False,
            'error': f'Incorrect verification code. {remaining_attempts} attempt(s) remaining.',
        }

    # OTP is valid: Clean up challenge session immediately to prevent reuse
    cache.delete(f"mfa_session:{clean_token}")
    cache.delete(f"mfa_user:{session['user_id']}")

    try:
        user = User.objects.get(pk=session['user_id'])
        return {'success': True, 'user': user, 'requested_role': session.get('requested_role', '')}
    except User.DoesNotExist:
        return {'success': False, 'error': 'User account not found.'}


def resend_mfa_code(mfa_token: str) -> dict:
    """Generate and dispatch a new OTP code if cooldown has elapsed."""
    clean_token = str(mfa_token or '').strip()
    session = cache.get(f"mfa_session:{clean_token}")
    if not session:
        return {'success': False, 'error': 'Verification session has expired. Please sign in again.'}

    now = time.time()
    resend_available_at = session.get('resend_available_at', 0)
    if now < resend_available_at:
        wait_seconds = int(resend_available_at - now) + 1
        return {
            'success': False,
            'error': f'Please wait {wait_seconds} seconds before requesting a new code.',
            'cooldown': wait_seconds,
        }

    new_otp = f"{secrets.randbelow(1000000):06d}"
    try:
        user = User.objects.get(pk=session['user_id'])
        send_otp_notification(user, new_otp, session.get('contact_info', {}))
    except Exception as exc:
        logger.warning('MFA resend delivery failed for user_id=%s', session.get('user_id'))
        return {
            'success': False,
            'error': 'We could not send a new verification code. Please try again later.',
            'delivery_error': True,
        }

    session['otp_code'] = new_otp
    session['resend_available_at'] = now + RESEND_COOLDOWN
    remaining_time = max(1, int(MFA_TTL - (now - session.get('created_at', now))))
    cache.set(f"mfa_session:{clean_token}", session, timeout=remaining_time)

    response = {
        'success': True,
        'message': 'A new 6-digit verification code has been dispatched.',
    }
    if _development_mfa_enabled():
        response['dev_otp'] = new_otp
    return response
