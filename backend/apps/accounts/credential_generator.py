"""One-time credential creation. Plaintext passwords never leave this module's caller."""
import re
import secrets
import string

from django.db import IntegrityError, transaction
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.utils.text import slugify

from apps.accounts.models import User


from django.conf import settings

ROLE_ALIASES = {'admin': User.Role.SCHOOL_ADMIN, 'school_admin': User.Role.SCHOOL_ADMIN}


def _role(role: str) -> str:
    return ROLE_ALIASES.get(role, role)


def _role_label(role: str) -> str:
    return 'Admin' if _role(role) == User.Role.SCHOOL_ADMIN else _role(role).capitalize()


def generate_login_id(first_name: str, role: str, school) -> str:
    """Return an unused, school-qualified login ID; User uniqueness is the final guard."""
    slug = slugify(first_name) or 'user'
    role_value = _role(role)
    plural = 'admins' if role_value == User.Role.SCHOOL_ADMIN else f'{role_value}s'
    subdomain = slugify(getattr(school, 'subdomain', '') or school.code)
    suffix = 1
    while True:
        local = slug if suffix == 1 else f'{slug}{suffix}'
        login_id = f'{local}@{plural}.{subdomain}.volpehub.education'
        if not User.objects.filter(email__iexact=login_id).exists():
            return login_id
        suffix += 1


def generate_password(name: str, role: str) -> str:
    """Create a strong temporary password that contains no personal data."""
    del name, role
    alphabet = string.ascii_letters + string.digits + '!@#$%^&*'
    for _ in range(10):
        password = ''.join(secrets.choice(alphabet) for _ in range(18))
        if not (any(char.islower() for char in password) and any(char.isupper() for char in password) and any(char.isdigit() for char in password) and any(char in '!@#$%^&*' for char in password)):
            continue
        try:
            validate_password(password)
            return password
        except ValidationError:
            continue
    raise RuntimeError('Unable to generate a password compliant with configured validators.')


def create_user_with_credentials(*, person, role: str, school, email: str | None = None):
    """Create a temporary credential pair. Caller may display password once, never persist it."""
    name = getattr(person, 'name', None) or getattr(person, 'first_name', None) or str(person)
    role_value = _role(role)
    for _ in range(20):
        login_id = email or generate_login_id(name.split()[0], role_value, school)
        password = generate_password(name, role_value)
        try:
            with transaction.atomic():
                user = User(username=login_id, email=login_id, first_name=name, role=role_value, school=school, is_active=True, must_change_password=True)
                user.set_password(password)
                user.save()
            return user, {'login_id': login_id, 'plaintext_password': password, 'mustChangePassword': True}
        except IntegrityError:
            if email:
                raise
    raise IntegrityError('Could not allocate a unique login ID.')
