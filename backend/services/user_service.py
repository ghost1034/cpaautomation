"""
PostgreSQL-only user service for ByteReview
Clean implementation without Firestore dependencies
"""
# pyright: reportArgumentType=false, reportAssignmentType=false, reportAttributeAccessIssue=false, reportGeneralTypeIssues=false, reportOptionalMemberAccess=false, reportReturnType=false

import asyncio

from models.user import UserCreate, UserUpdate, UserResponse
from models.db_models import User as DBUser
from core.database import db_config
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from datetime import datetime
from typing import Awaitable, Callable, Optional, cast
import inspect
import logging
import re

logger = logging.getLogger(__name__)

_E164_PHONE_NUMBER_RE = re.compile(r"^\+[1-9]\d{1,14}$")


PhoneLookup = Callable[[str], Optional[str] | Awaitable[Optional[str]]]


class DuplicatePhoneNumberError(Exception):
    """Raised when a verified phone number is already linked to another app user."""

class UserService:
    """
    User service that uses only PostgreSQL
    Clean implementation for the new ByteReview architecture
    """
    
    def __init__(self):
        """Initialize with PostgreSQL connection"""
        try:
            # Test connection
            db = db_config.get_session()
            db.close()
            logger.info("PostgreSQL user service initialized")
        except Exception as e:
            logger.error(f"Failed to initialize user service: {e}")
            raise

    def _get_session(self) -> Session:
        """Get PostgreSQL session"""
        return db_config.get_session()

    @staticmethod
    def _normalize_phone_number(phone_number: Optional[str]) -> Optional[str]:
        clean_phone = (phone_number or "").strip()
        return clean_phone or None

    @staticmethod
    def normalize_e164_phone_number(phone_number: Optional[str]) -> Optional[str]:
        normalized_phone = UserService._normalize_phone_number(phone_number)
        if normalized_phone is None:
            return None
        if not _E164_PHONE_NUMBER_RE.fullmatch(normalized_phone):
            raise ValueError("Enter a valid phone number in E.164 format")
        return normalized_phone

    @staticmethod
    def _to_response(pg_user: DBUser) -> UserResponse:
        return UserResponse(
            uid=pg_user.id,
            email=pg_user.email,
            phone_number=pg_user.phone_number,
            phone_verified_at=pg_user.phone_verified_at,
            display_name=pg_user.display_name,
            photo_url=pg_user.photo_url,
            created_at=pg_user.created_at,
            updated_at=pg_user.updated_at,
            welcome_tour_seen_at=pg_user.welcome_tour_seen_at,
            is_system_admin=bool(pg_user.is_system_admin),
        )

    def _apply_verified_phone(self, pg_user: DBUser, phone_number: Optional[str], phone_verified_at: Optional[datetime] = None) -> None:
        normalized_phone = self._normalize_phone_number(phone_number)
        if normalized_phone is None:
            return

        existing_phone_number = cast(Optional[str], pg_user.phone_number)

        if existing_phone_number != normalized_phone:
            pg_user.phone_number = normalized_phone
            pg_user.phone_verified_at = phone_verified_at or datetime.utcnow()
            return

        if pg_user.phone_verified_at is None:
            pg_user.phone_verified_at = phone_verified_at or datetime.utcnow()

    @staticmethod
    def _raise_if_phone_conflict(error: IntegrityError) -> None:
        error_message = str(error.orig).lower()
        if "phone_number" in error_message:
            raise DuplicatePhoneNumberError("That phone number is already linked to another account") from error

    async def is_phone_number_available(
        self,
        phone_number: str,
        requesting_uid: Optional[str] = None,
        lookup_verified_phone: Optional[PhoneLookup] = None,
    ) -> bool:
        """A phone is available unless another user verifiably holds it.

        The caller's own row never blocks them. When another row holds the number and
        ``lookup_verified_phone`` is given, that holder's live Firebase phone is checked;
        a stored number they no longer have is cleared so it stops blocking everyone else.
        Lookup failures keep the number unavailable rather than guessing.
        """
        normalized_phone = self.normalize_e164_phone_number(phone_number)
        db = self._get_session()
        try:
            query = db.query(DBUser.id).filter(DBUser.phone_number == normalized_phone)
            if requesting_uid:
                query = query.filter(DBUser.id != requesting_uid)
            holder = query.first()
        except SQLAlchemyError as e:
            logger.error(f"Failed to check phone availability for {normalized_phone}: {e}")
            raise
        finally:
            db.close()

        if holder is None:
            return True
        if lookup_verified_phone is None:
            return False

        holder_id = cast(str, holder.id)
        try:
            holder_live_phone = await self._lookup_phone(lookup_verified_phone, holder_id)
        except Exception as e:
            logger.warning(f"Could not confirm phone holder {holder_id} in Firebase; treating phone as taken: {e}")
            return False

        if holder_live_phone == normalized_phone:
            return False

        logger.info(f"Clearing stale phone for user {holder_id}; Firebase no longer has it verified")
        return self._clear_stored_phone(holder_id, expected_phone=normalized_phone)

    async def reconcile_phone_number(self, uid: str, lookup_verified_phone: PhoneLookup) -> Optional[UserResponse]:
        """Make the stored phone match the user's live Firebase phone (set, change, or clear).

        Raises if Firebase can't be read, and DuplicatePhoneNumberError if another account
        still holds the new number.
        """
        live_phone = self._normalize_phone_number(await self._lookup_phone(lookup_verified_phone, uid))
        user = await self.get_user(uid)
        if user is None or user.phone_number == live_phone:
            return user
        if live_phone is None:
            self._clear_stored_phone(uid, expected_phone=user.phone_number)
            return await self.get_user(uid)
        # Frees the number if a stale row (not a live holder) is what would collide
        await self.is_phone_number_available(live_phone, requesting_uid=uid, lookup_verified_phone=lookup_verified_phone)
        return await self.update_user(uid, UserUpdate(phone_number=live_phone))

    @staticmethod
    async def _lookup_phone(lookup_verified_phone: PhoneLookup, uid: str) -> Optional[str]:
        phone_number = lookup_verified_phone(uid)
        if inspect.isawaitable(phone_number):
            phone_number = await phone_number
        return UserService._normalize_phone_number(phone_number)

    def _clear_stored_phone(self, uid: str, expected_phone: Optional[str]) -> bool:
        """Clear a user's stored phone only if it still equals ``expected_phone`` (race-safe)."""
        db = self._get_session()
        try:
            cleared = (
                db.query(DBUser)
                .filter(DBUser.id == uid, DBUser.phone_number == expected_phone)
                .update(
                    {
                        DBUser.phone_number: None,
                        DBUser.phone_verified_at: None,
                        DBUser.updated_at: datetime.utcnow(),
                    },
                    synchronize_session=False,
                )
            )
            db.commit()
            return cleared > 0
        except SQLAlchemyError as e:
            logger.error(f"Failed to clear stale phone for user {uid}: {e}")
            db.rollback()
            raise
        finally:
            db.close()

    async def create_user(self, user_data: UserCreate) -> UserResponse:
        """Create a new user in PostgreSQL"""
        db = self._get_session()
        try:
            logger.info(f"UserService: Creating user with display_name='{user_data.display_name}'")
            
            pg_user = DBUser(
                id=user_data.uid,
                email=user_data.email,
                phone_number=self._normalize_phone_number(user_data.phone_number),
                phone_verified_at=user_data.phone_verified_at,
                display_name=user_data.display_name,
                photo_url=user_data.photo_url
            )
            db.add(pg_user)
            db.commit()
            db.refresh(pg_user)
            
            logger.info(f"UserService: After DB save, display_name='{pg_user.display_name}'")
            
            # Convert to response format
            return self._to_response(pg_user)
            
        except IntegrityError as e:
            logger.error(f"Failed to create user {user_data.uid}: {e}")
            db.rollback()
            self._raise_if_phone_conflict(e)
            raise
        except SQLAlchemyError as e:
            logger.error(f"Failed to create user {user_data.uid}: {e}")
            db.rollback()
            raise
        finally:
            db.close()

    async def get_user(self, uid: str) -> Optional[UserResponse]:
        """Get user by UID"""
        db = self._get_session()
        try:
            pg_user = db.query(DBUser).filter(DBUser.id == uid).first()
            if not pg_user:
                return None
            
            return self._to_response(pg_user)
            
        except SQLAlchemyError as e:
            logger.error(f"Error getting user {uid}: {e}")
            raise
        finally:
            db.close()

    async def update_user(self, uid: str, user_update: UserUpdate) -> Optional[UserResponse]:
        """Update user information"""
        db = self._get_session()
        try:
            pg_user = db.query(DBUser).filter(DBUser.id == uid).first()
            if not pg_user:
                return None
            
            # Update fields
            if user_update.display_name is not None:
                pg_user.display_name = user_update.display_name
            if user_update.photo_url is not None:
                pg_user.photo_url = user_update.photo_url
            if user_update.phone_number is not None or user_update.phone_verified_at is not None:
                self._apply_verified_phone(
                    pg_user,
                    user_update.phone_number,
                    user_update.phone_verified_at,
                )
            
            pg_user.updated_at = datetime.utcnow()
            
            db.commit()
            db.refresh(pg_user)
            
            logger.info(f"Updated user {uid}")
            
            return self._to_response(pg_user)
            
        except IntegrityError as e:
            logger.error(f"Failed to update user {uid}: {e}")
            db.rollback()
            self._raise_if_phone_conflict(e)
            raise
        except SQLAlchemyError as e:
            logger.error(f"Failed to update user {uid}: {e}")
            db.rollback()
            raise
        finally:
            db.close()

    async def mark_welcome_tour_seen(self, uid: str) -> Optional[UserResponse]:
        """Mark the one-time welcome tour dialog as seen (idempotent)"""
        db = self._get_session()
        try:
            pg_user = db.query(DBUser).filter(DBUser.id == uid).first()
            if not pg_user:
                return None

            if pg_user.welcome_tour_seen_at is None:
                pg_user.welcome_tour_seen_at = datetime.utcnow()
                db.commit()
                db.refresh(pg_user)

            return self._to_response(pg_user)

        except SQLAlchemyError as e:
            logger.error(f"Failed to mark welcome tour seen for {uid}: {e}")
            db.rollback()
            raise
        finally:
            db.close()

    async def _resolve_optional_phone(
        self,
        resolve_phone_number: Optional[Callable[[], Optional[str] | Awaitable[Optional[str]]]],
    ) -> Optional[str]:
        if not resolve_phone_number:
            return None
        phone_number = resolve_phone_number()
        if inspect.isawaitable(phone_number):
            return await phone_number
        return phone_number

    async def get_or_create_user(self, uid: str, email: str, resolve_phone_number: Optional[Callable[[], Optional[str] | Awaitable[Optional[str]]]] = None, display_name: Optional[str] = None, photo_url: Optional[str] = None) -> UserResponse:
        """Get existing user or create new one (does not update existing users)"""
        user = await self.get_user(uid)
        if user:
            return user

        # Create new user; resolve the verified phone lazily (Firebase Admin lookup)
        phone_number = await self._resolve_optional_phone(resolve_phone_number)
        user_create = UserCreate(
            uid=uid,
            email=email,
            phone_number=phone_number,
            phone_verified_at=datetime.utcnow() if phone_number else None,
            display_name=display_name,
            photo_url=photo_url
        )
        return await self.create_user(user_create)

    async def sync_user_profile(self, uid: str, email: str, resolve_phone_number: Optional[Callable[[], Optional[str] | Awaitable[Optional[str]]]] = None, display_name: Optional[str] = None, photo_url: Optional[str] = None) -> UserResponse:
        """Sync user profile - creates user if doesn't exist, updates profile if it does"""
        user = await self.get_user(uid)
        # Only resolve the phone (Firebase Admin lookup) when it isn't recorded yet,
        # so steady-state syncs make zero extra Firebase calls
        needs_phone = user is None or user.phone_number is None
        phone_number = await self._resolve_optional_phone(resolve_phone_number) if needs_phone else None
        if user:
            # Always update the profile during sync; _apply_verified_phone owns the
            # phone_verified_at stamp (first record / change only)
            user_update = UserUpdate(
                phone_number=phone_number,
                phone_verified_at=None,
                display_name=display_name,
                photo_url=photo_url
            )
            updated_user = await self.update_user(uid, user_update)
            return updated_user
        else:
            # Create new user
            user_create = UserCreate(
                uid=uid,
                email=email,
                phone_number=phone_number,
                phone_verified_at=datetime.utcnow() if phone_number else None,
                display_name=display_name,
                photo_url=photo_url
            )
            return await self.create_user(user_create)

    async def delete_user_account(self, uid: str) -> bool:
        """Permanently delete user account and all associated data."""
        return await asyncio.to_thread(self._delete_user_account_sync, uid)

    def _delete_user_account_sync(self, uid: str) -> bool:
        """
        Permanently delete user account and all associated data
        This includes:
        - User profile
        - All extraction jobs and results
        - Templates and field configurations
        - Billing account and usage data
        - Integration accounts
        - Automation configurations
        - All files from cloud storage
        """
        db = self._get_session()
        try:
            # Import here to avoid circular imports
            from models.db_models import (
                User, ExtractionJob, ExtractionTask, ExtractionResult, 
                SourceFile, JobField, Template, BillingAccount, 
                UsageCounter, IntegrationAccount, Automation, AutomationRun, JobRun
            )
            from services.gcs_service import GCSService
            
            logger.info(f"Starting account deletion for user {uid}")
            
            # Initialize GCS service for file cleanup
            gcs_service = GCSService()
            
            # Get user to verify they exist
            user = db.query(User).filter(User.id == uid).first()
            if not user:
                logger.warning(f"User {uid} not found for deletion")
                return False
            
            # 1. Delete all user files from cloud storage
            # TODO: Implement this properly later
            try:
                # Delete all files in user's directory
                gcs_service.delete_user_files(uid)
                logger.info(f"Deleted cloud storage files for user {uid}")
            except Exception as e:
                logger.error(f"Failed to delete cloud storage files for user {uid}: {e}")
                # Continue with database deletion even if file deletion fails
            
            # 2. Delete database records in dependency order
            
            # Delete automation runs first (via automation relationship)
            automation_runs = db.query(AutomationRun).join(Automation).filter(Automation.user_id == uid).all()
            for run in automation_runs:
                db.delete(run)
            logger.info(f"Deleted {len(automation_runs)} automation runs")
            
            # Delete automations
            automations = db.query(Automation).filter(Automation.user_id == uid).all()
            for automation in automations:
                db.delete(automation)
            logger.info(f"Deleted {len(automations)} automations")
            
            # Delete integration accounts
            integration_accounts = db.query(IntegrationAccount).filter(IntegrationAccount.user_id == uid).all()
            for account in integration_accounts:
                db.delete(account)
            logger.info(f"Deleted {len(integration_accounts)} integration accounts")
            
            # Delete extraction results
            extraction_results = (
                db.query(ExtractionResult)
                  .join(ExtractionTask, ExtractionResult.task)
                  .join(JobRun, ExtractionTask.job_run)
                  .join(ExtractionJob, JobRun.job)
                  .filter(ExtractionJob.user_id == uid)
                  .all()
            )
            for result in extraction_results:
                db.delete(result)
            logger.info(f"Deleted {len(extraction_results)} extraction results")
            
            # Delete job fields
            job_fields = (
                db.query(JobField)
                  .join(JobRun, JobField.job_run)
                  .join(ExtractionJob, JobRun.job)
                  .filter(ExtractionJob.user_id == uid)
                  .all()
            )
            for job_field in job_fields:
                db.delete(job_field)
            logger.info(f"Deleted {len(job_fields)} job fields")
            
            # Delete extraction tasks
            extraction_tasks = (
                db.query(ExtractionTask)
                  .join(JobRun, ExtractionTask.job_run)
                  .join(ExtractionJob, JobRun.job)
                  .filter(ExtractionJob.user_id == uid)
                  .all()
            )
            for task in extraction_tasks:
                db.delete(task)
            logger.info(f"Deleted {len(extraction_tasks)} extraction tasks")
            
            # Delete source files
            source_files = (
                db.query(SourceFile)
                  .join(JobRun, SourceFile.job_run)
                  .join(ExtractionJob, JobRun.job)
                  .filter(ExtractionJob.user_id == uid)
                  .all()
            )
            for source_file in source_files:
                db.delete(source_file)
            logger.info(f"Deleted {len(source_files)} source files")
            
            # Delete extraction jobs
            extraction_jobs = db.query(ExtractionJob).filter(ExtractionJob.user_id == uid).all()
            for job in extraction_jobs:
                db.delete(job)
            logger.info(f"Deleted {len(extraction_jobs)} extraction jobs")
            
            # Delete templates
            templates = db.query(Template).filter(Template.user_id == uid).all()
            for template in templates:
                db.delete(template)
            logger.info(f"Deleted {len(templates)} templates")
            
            # Delete usage counters
            usage_counters = db.query(UsageCounter).filter(UsageCounter.user_id == uid).all()
            for counter in usage_counters:
                db.delete(counter)
            logger.info(f"Deleted {len(usage_counters)} usage counters")
            
            # Delete billing account
            # TODO: Cancel Stripe subscription automatically
            billing_account = db.query(BillingAccount).filter(BillingAccount.user_id == uid).first()
            if billing_account:
                db.delete(billing_account)
                logger.info("Deleted billing account")
            
            # Finally, delete the user
            db.delete(user)
            
            # Commit all deletions
            db.commit()
            
            logger.info(f"Successfully deleted user account {uid} and all associated data")
            return True
            
        except Exception as e:
            logger.error(f"Failed to delete user account {uid}: {e}")
            db.rollback()
            raise
        finally:
            db.close()

    # TODO: Implement subscription and usage tracking methods when needed
    # async def update_stripe_customer(self, uid: str, stripe_customer_id: str) -> Optional[UserResponse]
    # async def update_subscription_status(self, uid: str, status: str, pages_limit: int = None) -> Optional[UserResponse]
    # async def increment_pages_used(self, uid: str, pages: int = 1) -> Optional[UserResponse]
