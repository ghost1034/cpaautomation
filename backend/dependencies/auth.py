"""
Authentication dependencies - Firebase token verification only
"""
from fastapi import HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth as firebase_auth, credentials, initialize_app
from typing import Dict, Optional
import asyncio
import logging
import os
import threading

from core.runtime import is_explicitly_local, local_auth_enabled

logger = logging.getLogger(__name__)
_firebase_init_lock = threading.Lock()

def init_firebase():
    """Initialize Firebase Admin SDK when a Firebase-backed operation needs it."""
    if local_auth_enabled():
        logger.info("Firebase Admin initialization skipped; local development identity is enabled")
        return

    import firebase_admin

    with _firebase_init_lock:
        if firebase_admin._apps:
            return
        try:
            service_account_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
            if service_account_path and os.path.exists(service_account_path):
                cred = credentials.Certificate(service_account_path)
                initialize_app(cred)
                logger.info("Firebase initialized with service account")
            else:
                # Use default credentials for development
                initialize_app()
                logger.info("Firebase initialized with default credentials")
        except Exception as e:
            logger.warning(f"Firebase initialization failed: {e}")
            raise

security = HTTPBearer()

_PHONE_MFA_EXEMPT_EMAILS = {
    "giorgi@itcare.ge",
}


def _normalize_phone_number(phone_number: Optional[str]) -> Optional[str]:
    clean_phone = (phone_number or "").strip()
    return clean_phone or None


def _normalize_email(email: Optional[str]) -> Optional[str]:
    clean_email = (email or "").strip().lower()
    return clean_email or None


def get_enrolled_mfa_phone_number(uid: str) -> Optional[str]:
    """
    Return the user's verified phone number (account phone or first phone MFA factor), or None.

    MFA-enrolled phone numbers are not present in Firebase ID token claims, so they must be
    fetched via the Admin SDK. firebase_admin 7.0.0 exposes no public MFA accessor on
    UserRecord, so the raw accounts:lookup payload (_data["mfaInfo"]) is read instead.

    Never raises — logs and returns None on failure so a Firebase outage can't 500 requests.
    """
    if local_auth_enabled() and uid == "local-developer":
        return None
    try:
        init_firebase()
        record = firebase_auth.get_user(uid)
    except Exception as e:
        logger.warning(f"Could not fetch Firebase user {uid} for MFA phone: {e}")
        return None

    phone = _normalize_phone_number(record.phone_number)  # phone-auth sign-in users
    if phone:
        return phone

    mfa_info = getattr(record, "_data", {}).get("mfaInfo") or []
    for factor in mfa_info:
        phone = _normalize_phone_number(factor.get("phoneInfo"))
        if phone:
            return phone
    return None


def _is_phone_mfa_exempt(decoded_token: Dict) -> bool:
    normalized_email = _normalize_email(decoded_token.get("email"))
    return normalized_email in _PHONE_MFA_EXEMPT_EMAILS if normalized_email else False


def _require_phone_mfa(decoded_token: Dict) -> None:
    if is_explicitly_local():
        return
    if _is_phone_mfa_exempt(decoded_token):
        return

    firebase_claims = decoded_token.get("firebase") or {}
    sign_in_second_factor = firebase_claims.get("sign_in_second_factor")
    if sign_in_second_factor != "phone":
        raise HTTPException(
            status_code=403,
            detail="A fresh SMS verification code is required to access CPAAutomation",
        )

async def verify_firebase_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Dict:
    """
    Firebase token verification dependency
    """
    if not credentials:
        logger.error("No authorization header provided")
        raise HTTPException(status_code=401, detail="Authorization header required")

    if local_auth_enabled():
        if credentials.credentials != "cpaautomation-local-development":
            raise HTTPException(status_code=401, detail="Invalid local development token")
        return {
            "uid": "local-developer",
            "email": os.getenv("LOCAL_AUTH_EMAIL", "local.developer@example.com"),
            "name": os.getenv("LOCAL_AUTH_NAME", "Local Developer"),
            "email_verified": True,
            "local_development": True,
        }
    
    try:
        init_firebase()
        logger.info(f"Verifying token: {credentials.credentials[:20]}...")
        # Verify the ID token using Firebase Admin SDK
        decoded_token = await asyncio.to_thread(firebase_auth.verify_id_token, credentials.credentials)
        uid = decoded_token.get("uid")
        if not uid:
            raise HTTPException(status_code=401, detail="User ID not found in token")

        _require_phone_mfa(decoded_token)
        decoded_token["phone_number"] = _normalize_phone_number(decoded_token.get("phone_number"))
        logger.info(f"Token verified for user: {decoded_token.get('uid', 'unknown')}")
        return decoded_token
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Token verification failed: {e}")
        logger.error(f"Token was: {credentials.credentials[:50]}...")
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


async def verify_optional_firebase_token(
    request: Request,
) -> Optional[Dict]:
    """Verify a Firebase token when supplied, while allowing bearer-link guests."""
    authorization = request.headers.get("authorization", "").strip()
    if not authorization:
        return None
    scheme, separator, credential = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not credential.strip():
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    credentials = HTTPAuthorizationCredentials(scheme=scheme, credentials=credential.strip())
    return await verify_firebase_token(credentials)

async def get_optional_uid_without_mfa(request: Request) -> Optional[str]:
    """Best-effort caller identity for pre-MFA flows (e.g. enrolling a phone).

    Skips the phone-MFA requirement because callers are, by definition, not yet
    enrolled. Any missing or invalid token yields None (anonymous) rather than
    an error, so only use this where identity merely narrows a result.
    """
    authorization = request.headers.get("authorization", "").strip()
    scheme, separator, credential = authorization.partition(" ")
    credential = credential.strip()
    if not separator or scheme.lower() != "bearer" or not credential:
        return None

    if local_auth_enabled():
        return "local-developer" if credential == "cpaautomation-local-development" else None

    try:
        init_firebase()
        decoded_token = await asyncio.to_thread(firebase_auth.verify_id_token, credential)
    except Exception as e:
        logger.info(f"Ignoring unverifiable optional token: {type(e).__name__}")
        return None
    return decoded_token.get("uid") or None

async def get_current_user_id(token_data: Dict = Depends(verify_firebase_token)) -> str:
    """
    Extract user ID from verified token
    Convenience dependency for routes that only need the user ID
    """
    return token_data["uid"]

async def get_current_user_email(token_data: Dict = Depends(verify_firebase_token)) -> str:
    """
    Extract user email from verified token
    Convenience dependency for routes that only need the email
    """
    email = token_data.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="User email not found in token")
    return email

async def verify_token_string(token: str) -> str:
    """
    Verify a raw Firebase token string and return user ID
    Used for SSE authentication via query parameter
    """
    if local_auth_enabled():
        if token != "cpaautomation-local-development":
            raise HTTPException(status_code=401, detail="Invalid local development token")
        return "local-developer"
    try:
        init_firebase()
        logger.info(f"Attempting to verify token: {token[:20]}...")
        decoded_token = await asyncio.to_thread(firebase_auth.verify_id_token, token)
        user_id = decoded_token.get('uid')
        if not user_id:
            logger.error("User ID not found in decoded token")
            raise HTTPException(status_code=401, detail="User ID not found in token")
        _require_phone_mfa(decoded_token)
        logger.info(f"Token verified successfully for user: {user_id}")
        return user_id
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(f"Token verification failed with exception: {type(e).__name__}: {e}")
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {str(e)}")
