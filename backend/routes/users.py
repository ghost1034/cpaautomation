"""
User management routes for ByteReview
PostgreSQL-only implementation
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import Optional
import asyncio
import logging
from services.user_service import DuplicatePhoneNumberError, UserService
from models.user import PhoneAvailabilityResponse, UserResponse, UserUpdate, UpdateProfileRequest
# Usage tracking imports will be added when billing is implemented
from dependencies.auth import get_enrolled_mfa_phone_number, get_optional_uid_without_mfa, verify_firebase_token

logger = logging.getLogger(__name__)

router = APIRouter()
user_service = UserService()

@router.get("/phone-availability", response_model=PhoneAvailabilityResponse)
async def get_phone_number_availability(
    phone_number: str = Query(..., min_length=2, max_length=32),
    requesting_uid: Optional[str] = Depends(get_optional_uid_without_mfa),
):
    try:
        return PhoneAvailabilityResponse(
            available=await user_service.is_phone_number_available(phone_number, requesting_uid=requesting_uid),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error checking phone availability: {str(e)}")

@router.get("/me", response_model=UserResponse)
async def get_current_user(token_data: dict = Depends(verify_firebase_token)):
    """Get current user information - returns existing user or creates minimal profile"""
    try:
        email = token_data.get("email")
        if not email:
            raise HTTPException(status_code=400, detail="User email not found in token")

        # Just get or create user with minimal data from token
        # Frontend will call /me/sync with complete profile data
        # MFA-enrolled phones aren't in token claims; resolved lazily via Firebase Admin
        user = await user_service.get_or_create_user(
            uid=token_data["uid"],
            email=email,
            resolve_phone_number=lambda: asyncio.to_thread(get_enrolled_mfa_phone_number, token_data["uid"]),
            display_name=None,  # Will be updated via /me/sync
            photo_url=None
        )
        return user
    except HTTPException:
        raise
    except DuplicatePhoneNumberError as e:
        logger.error(f"Verified phone for user {token_data.get('uid')} is already linked to another account")
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting user: {str(e)}")

class UserSyncRequest(BaseModel):
    display_name: Optional[str] = None
    photo_url: Optional[str] = None

@router.post("/me/sync", response_model=UserResponse)
async def sync_user_profile(
    sync_data: UserSyncRequest,
    token_data: dict = Depends(verify_firebase_token)
):
    """
    Sync user profile with data from frontend
    Frontend sends complete user profile data
    """
    try:
        email = token_data.get("email")
        if not email:
            raise HTTPException(status_code=400, detail="User email not found in token")

        # MFA-enrolled phones aren't in token claims; resolved lazily via Firebase Admin
        user = await user_service.sync_user_profile(
            uid=token_data["uid"],
            email=email,
            resolve_phone_number=lambda: asyncio.to_thread(get_enrolled_mfa_phone_number, token_data["uid"]),
            display_name=sync_data.display_name,
            photo_url=sync_data.photo_url
        )
        return user
    except HTTPException:
        raise
    except DuplicatePhoneNumberError as e:
        logger.error(f"Verified phone for user {token_data.get('uid')} is already linked to another account")
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error syncing user: {str(e)}")

@router.put("/me", response_model=UserResponse)
async def update_current_user(
    profile_update: UpdateProfileRequest,
    token_data: dict = Depends(verify_firebase_token)
):
    """Update current user's profile"""
    try:
        user_update = UserUpdate(display_name=profile_update.display_name)
        user = await user_service.update_user(token_data["uid"], user_update)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating user: {str(e)}")

@router.post("/me/welcome-tour-seen", response_model=UserResponse)
async def mark_welcome_tour_seen(token_data: dict = Depends(verify_firebase_token)):
    """Mark the one-time welcome tour dialog as seen for the current user (idempotent)"""
    try:
        user = await user_service.mark_welcome_tour_seen(token_data["uid"])
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error marking welcome tour seen: {str(e)}")

@router.delete("/me")
async def delete_current_user(
    token_data: dict = Depends(verify_firebase_token)
):
    """
    Permanently delete the current user's account and all associated data
    This action cannot be undone
    """
    try:
        success = await user_service.delete_user_account(token_data["uid"])
        if not success:
            raise HTTPException(status_code=404, detail="User not found")
        
        return {"message": "Account successfully deleted"}
    except HTTPException:
        raise
        
    except Exception as e:
        logger.error(f"Failed to delete user account {token_data['uid']}: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting account: {str(e)}")

# Usage tracking endpoints will be added when Stripe billing is implemented

# Migration endpoint removed - no longer needed since we're PostgreSQL-only
