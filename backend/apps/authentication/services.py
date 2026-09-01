import pyotp
import jwt
from datetime import datetime, timedelta, timezone
from django.conf import settings
from rest_framework_simplejwt.tokens import RefreshToken
from .models import User

def generate_tokens_for_user(user: User) -> dict:
    """Generate SimpleJWT access and refresh tokens for a user."""
    refresh = RefreshToken.for_user(user)
    # Add custom claims to the JWT payload
    refresh['email'] = user.email
    refresh['role'] = user.role
    refresh['name'] = user.full_name

    return {
        'access': str(refresh.access_token),
        'refresh': str(refresh),
    }

def generate_partial_auth_token(user: User) -> str:
    """Generate a temporary short-lived token for 2FA challenge (5 min expiry)."""
    payload = {
        'sub': str(user.id),
        'email': user.email,
        'type': '2fa_challenge',
        'exp': datetime.now(timezone.utc) + timedelta(minutes=5),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm='HS256')

def verify_partial_auth_token(token: str) -> User | None:
    """Decode and validate a 2FA challenge token."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=['HS256'])
        if payload.get('type') != '2fa_challenge':
            return None
        user_id = payload.get('sub')
        return User.objects.filter(id=user_id, is_active=True).first()
    except (jwt.PyJWTError, Exception):
        return None

def verify_totp_code(secret: str, code: str) -> bool:
    """Verify a 6-digit TOTP code against a base32 secret."""
    if not secret or not code:
        return False
    totp = pyotp.TOTP(secret)
    # Allow 1 time step drift (30 seconds before/after)
    return totp.verify(code, valid_window=1)

def generate_totp_secret() -> str:
    """Generate a random base32 TOTP secret."""
    return pyotp.random_base32()
