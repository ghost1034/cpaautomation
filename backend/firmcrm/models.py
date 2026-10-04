"""CRM object model.

Salesforce/HubSpot analogues:  FirmCrmLead -> (convert) -> FirmCrmAccount + FirmCrmContact + FirmCrmOpportunity.
Professional-services additions: FirmCrmPracticeArea, FirmCrmConflictCheck (conflict / independence clearance that gates
Closed-Won), FirmCrmEngagement (the won deal as a matter/engagement), origination + referral attribution, FirmCrmCampaign.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.db_models import Base
from uuid import UUID
from sqlalchemy import Uuid, and_, select, func
from sqlalchemy.ext.hybrid import hybrid_property
from models.db_models import Client as SharedClient
from sqlalchemy.orm import foreign


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class FirmMixin:
    firm_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("firms.id", ondelete="CASCADE"), nullable=False, index=True)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class FirmCrmUser(Base, FirmMixin, TimestampMixin):
    __tablename__ = "firmcrm_members"
    id: Mapped[str] = mapped_column(String(128), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    firm_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("firms.id", ondelete="CASCADE"), primary_key=True)
    email: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="staff")
    title: Mapped[str | None] = mapped_column(String(255))
    practice_area_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_practice_areas.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class ArchiveMixin:
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime)


class FirmCrmPracticeArea(Base, FirmMixin):
    __table_args__ = (UniqueConstraint("firm_id", "name"),)
    __tablename__ = "firmcrm_practice_areas"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    discipline: Mapped[str] = mapped_column(String(30))  # accounting|legal|advisory|other
    # Which clearance gate applies before an opportunity may be won.
    clearance_type: Mapped[str | None] = mapped_column(String(20))  # conflict|independence|None
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class FirmCrmPipeline(Base, FirmMixin):
    __table_args__ = (UniqueConstraint("firm_id", "name"),)
    __tablename__ = "firmcrm_pipelines"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    stages: Mapped[list[FirmCrmStage]] = relationship(back_populates="pipeline", order_by="FirmCrmStage.position",
                                               cascade="all, delete-orphan")


class FirmCrmStage(Base, FirmMixin):
    __tablename__ = "firmcrm_stages"
    __table_args__ = (UniqueConstraint("firm_id", "pipeline_id", "name"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("firmcrm_pipelines.id"))
    name: Mapped[str] = mapped_column(String(80))
    position: Mapped[int] = mapped_column(Integer, default=0)
    probability: Mapped[int] = mapped_column(Integer, default=10)  # default % when entering this stage
    is_won: Mapped[bool] = mapped_column(Boolean, default=False)
    is_lost: Mapped[bool] = mapped_column(Boolean, default=False)
    pipeline: Mapped[FirmCrmPipeline] = relationship(back_populates="stages")


class FirmCrmAccount(Base, FirmMixin, TimestampMixin, ArchiveMixin):
    """Company or individual the firm serves / pursues (SFDC FirmCrmAccount, HubSpot Company)."""

    __tablename__ = "firmcrm_accounts"
    shared_client_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("clients.id", ondelete="RESTRICT"), unique=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    _name: Mapped[str] = mapped_column("name", String(255), index=True)
    aliases: Mapped[str | None] = mapped_column(String(500))  # comma-separated former names / DBAs
    account_type: Mapped[str] = mapped_column(String(30), default="prospect")
    # prospect|client|former_client|referral_source|adverse_party|vendor|other
    entity_kind: Mapped[str] = mapped_column(String(20), default="company")  # company|individual|trust|estate
    _industry: Mapped[str | None] = mapped_column("industry", String(255))
    website: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(40))
    address: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(80))
    state: Mapped[str | None] = mapped_column(String(40))
    postal_code: Mapped[str | None] = mapped_column(String(20))
    country: Mapped[str] = mapped_column(String(40), default="United States")
    revenue_band: Mapped[str | None] = mapped_column(String(40))
    employee_band: Mapped[str | None] = mapped_column(String(40))
    owner_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))  # relationship partner
    originating_partner_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    referral_account_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_accounts.id"))
    referral_contact_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_contacts.id", use_alter=True, name="firmcrm_fk_accounts_referral_contact_id_contacts"))
    client_since: Mapped[date | None] = mapped_column(Date)
    risk_rating: Mapped[str | None] = mapped_column(String(10))  # low|medium|high
    is_public_company: Mapped[bool] = mapped_column(Boolean, default=False)  # independence relevance
    tags: Mapped[list | None] = mapped_column(JSON, default=list)
    description: Mapped[str | None] = mapped_column(Text)

    owner: Mapped[FirmCrmUser | None] = relationship(primaryjoin="and_(FirmCrmAccount.owner_id == foreign(FirmCrmUser.id), FirmCrmAccount.firm_id == foreign(FirmCrmUser.firm_id))", uselist=False, viewonly=True)
    originating_partner: Mapped[FirmCrmUser | None] = relationship(primaryjoin="and_(FirmCrmAccount.originating_partner_id == foreign(FirmCrmUser.id), FirmCrmAccount.firm_id == foreign(FirmCrmUser.firm_id))", uselist=False, viewonly=True)
    contacts: Mapped[list[FirmCrmContact]] = relationship(back_populates="account", foreign_keys="FirmCrmContact.account_id")
    opportunities: Mapped[list[FirmCrmOpportunity]] = relationship(back_populates="account", foreign_keys="FirmCrmOpportunity.account_id")


    shared_client: Mapped[SharedClient | None] = relationship(SharedClient, foreign_keys=[shared_client_id], viewonly=True)

    @hybrid_property
    def name(self):
        return self.shared_client.name if self.shared_client_id and self.shared_client else self._name

    @name.setter
    def name(self, value):
        self._name = value

    @name.expression
    def name(cls):
        return func.coalesce(select(SharedClient.name).where(SharedClient.id == cls.shared_client_id, SharedClient.firm_id == cls.firm_id).correlate_except(SharedClient).scalar_subquery(), cls._name)

    @hybrid_property
    def industry(self):
        return self.shared_client.industry if self.shared_client_id and self.shared_client else self._industry

    @industry.setter
    def industry(self, value):
        self._industry = value

    @industry.expression
    def industry(cls):
        from sqlalchemy import case
        return case((cls.shared_client_id.is_not(None), select(SharedClient.industry).where(SharedClient.id == cls.shared_client_id, SharedClient.firm_id == cls.firm_id).correlate_except(SharedClient).scalar_subquery()), else_=cls._industry)

class FirmCrmContact(Base, FirmMixin, TimestampMixin, ArchiveMixin):
    __tablename__ = "firmcrm_contacts"
    __table_args__ = (Index("firmcrm_uq_contacts_email_active", "firm_id", "email", unique=True,
                            postgresql_where=text("email IS NOT NULL AND is_archived = false"),
                            sqlite_where=text("email IS NOT NULL AND is_archived = 0")),)
    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80), index=True)
    email: Mapped[str | None] = mapped_column(String(255), index=True)
    phone: Mapped[str | None] = mapped_column(String(40))
    title: Mapped[str | None] = mapped_column(String(120))
    account_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_accounts.id"))
    role: Mapped[str | None] = mapped_column(String(40))  # decision_maker|influencer|champion|gatekeeper|referral_source|other
    owner_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    lifecycle: Mapped[str] = mapped_column(String(20), default="lead")  # lead|prospect|client|referral_source|other
    do_not_contact: Mapped[bool] = mapped_column(Boolean, default=False)
    linkedin: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime)

    account: Mapped[FirmCrmAccount | None] = relationship(back_populates="contacts", foreign_keys=[account_id])
    owner: Mapped[FirmCrmUser | None] = relationship(primaryjoin="and_(FirmCrmContact.owner_id == foreign(FirmCrmUser.id), FirmCrmContact.firm_id == foreign(FirmCrmUser.firm_id))", uselist=False, viewonly=True)

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()


class FirmCrmLead(Base, FirmMixin, TimestampMixin, ArchiveMixin):
    """Unqualified inbound interest. Converting creates FirmCrmAccount + FirmCrmContact (+ optional FirmCrmOpportunity)."""

    __tablename__ = "firmcrm_leads"
    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    company: Mapped[str | None] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(40))
    title: Mapped[str | None] = mapped_column(String(120))
    source: Mapped[str] = mapped_column(String(40), default="web")  # web|referral|event|webinar|cold|partner|other
    status: Mapped[str] = mapped_column(String(20), default="new")  # new|contacted|qualified|unqualified|converted
    practice_area_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_practice_areas.id"))
    owner_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_campaigns.id"))
    referral_contact_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_contacts.id"))
    estimated_value: Mapped[float | None] = mapped_column(Float)
    need_summary: Mapped[str | None] = mapped_column(Text)
    score: Mapped[int] = mapped_column(Integer, default=0)
    unqualified_reason: Mapped[str | None] = mapped_column(String(200))
    converted_account_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_accounts.id"))
    converted_contact_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_contacts.id"))
    converted_opportunity_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_opportunities.id", use_alter=True, name="firmcrm_fk_leads_converted_opportunity_id_opportunities"))
    converted_at: Mapped[datetime | None] = mapped_column(DateTime)

    owner: Mapped[FirmCrmUser | None] = relationship(primaryjoin="and_(FirmCrmLead.owner_id == foreign(FirmCrmUser.id), FirmCrmLead.firm_id == foreign(FirmCrmUser.firm_id))", uselist=False, viewonly=True)


class FirmCrmOpportunity(Base, FirmMixin, TimestampMixin, ArchiveMixin):
    """A pursuit for a new engagement (SFDC FirmCrmOpportunity / HubSpot Deal)."""

    __tablename__ = "firmcrm_opportunities"
    __table_args__ = (Index("firmcrm_ix_opportunities_status_stage", "status", "stage_id"),
                      Index("firmcrm_ix_opportunities_owner_status", "owner_id", "status"))
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("firmcrm_accounts.id"))
    primary_contact_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_contacts.id"))
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("firmcrm_pipelines.id"))
    stage_id: Mapped[int] = mapped_column(ForeignKey("firmcrm_stages.id"))
    practice_area_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_practice_areas.id"))
    owner_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))  # pursuit lead
    originating_partner_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))  # origination credit
    responsible_partner_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))  # will run the work
    referral_contact_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_contacts.id"))
    referral_account_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_accounts.id"))
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_campaigns.id"))
    amount: Mapped[float] = mapped_column(Float, default=0.0)  # estimated first-year fees
    fee_type: Mapped[str] = mapped_column(String(20), default="hourly")  # hourly|fixed|retainer|recurring|contingency|value
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=False)
    probability: Mapped[int] = mapped_column(Integer, default=10)
    expected_close: Mapped[date | None] = mapped_column(Date)
    proposal_due: Mapped[date | None] = mapped_column(Date)
    engagement_letter_status: Mapped[str] = mapped_column(String(20), default="not_started")
    # not_started|drafted|sent|signed
    status: Mapped[str] = mapped_column(String(10), default="open")  # open|won|lost
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)
    lost_reason: Mapped[str | None] = mapped_column(String(60))
    competitor: Mapped[str | None] = mapped_column(String(120))
    adverse_parties: Mapped[list | None] = mapped_column(JSON, default=list)  # names; feeds conflict search
    description: Mapped[str | None] = mapped_column(Text)
    next_step: Mapped[str | None] = mapped_column(String(255))
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime)
    stage_entered_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    account: Mapped[FirmCrmAccount] = relationship(back_populates="opportunities", foreign_keys=[account_id])
    stage: Mapped[FirmCrmStage] = relationship()
    practice_area: Mapped[FirmCrmPracticeArea | None] = relationship()
    owner: Mapped[FirmCrmUser | None] = relationship(primaryjoin="and_(FirmCrmOpportunity.owner_id == foreign(FirmCrmUser.id), FirmCrmOpportunity.firm_id == foreign(FirmCrmUser.firm_id))", uselist=False, viewonly=True)
    originating_partner: Mapped[FirmCrmUser | None] = relationship(primaryjoin="and_(FirmCrmOpportunity.originating_partner_id == foreign(FirmCrmUser.id), FirmCrmOpportunity.firm_id == foreign(FirmCrmUser.firm_id))", uselist=False, viewonly=True)
    stage_history: Mapped[list[FirmCrmStageHistory]] = relationship(back_populates="opportunity", cascade="all, delete-orphan")


class FirmCrmStageHistory(Base, FirmMixin):
    __tablename__ = "firmcrm_stage_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    opportunity_id: Mapped[int] = mapped_column(ForeignKey("firmcrm_opportunities.id"))
    from_stage_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_stages.id"))
    to_stage_id: Mapped[int] = mapped_column(ForeignKey("firmcrm_stages.id"))
    changed_by_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    days_in_previous: Mapped[float | None] = mapped_column(Float)
    opportunity: Mapped[FirmCrmOpportunity] = relationship(back_populates="stage_history")


class FirmCrmActivity(Base, FirmMixin, TimestampMixin):
    """Calls, emails, meetings, notes, tasks. Polymorphic via nullable FKs."""

    __tablename__ = "firmcrm_activities"
    __table_args__ = (Index("firmcrm_ix_activities_owner_kind_completed", "owner_id", "kind", "completed_at"),
                      Index("firmcrm_ix_activities_occurred", "occurred_at"))
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))  # call|email|meeting|note|task
    subject: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    owner_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    account_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_accounts.id"), index=True)
    contact_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_contacts.id"), index=True)
    opportunity_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_opportunities.id"), index=True)
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_leads.id"), index=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    priority: Mapped[str] = mapped_column(String(10), default="normal")  # low|normal|high
    owner: Mapped[FirmCrmUser | None] = relationship(primaryjoin="and_(FirmCrmActivity.owner_id == foreign(FirmCrmUser.id), FirmCrmActivity.firm_id == foreign(FirmCrmUser.firm_id))", uselist=False, viewonly=True)


class FirmCrmConflictCheck(Base, FirmMixin, TimestampMixin):
    """Clearance before accepting work. check_type=conflict (legal) | independence (attest/accounting)."""

    __tablename__ = "firmcrm_conflict_checks"
    id: Mapped[int] = mapped_column(primary_key=True)
    check_type: Mapped[str] = mapped_column(String(20), default="conflict")
    opportunity_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_opportunities.id"), index=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_accounts.id"), index=True)
    requested_by_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    parties: Mapped[list] = mapped_column(JSON, default=list)  # names searched (client, affiliates, adverse)
    matches: Mapped[list] = mapped_column(JSON, default=list)  # [{party, matched_name, entity, id, relationship, score}]
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|clear|conflict|waived
    resolution_note: Mapped[str | None] = mapped_column(Text)
    resolved_by_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Independence-specific attributes
    independence_attestation: Mapped[dict | None] = mapped_column(JSON)  # {financial_interest: bool, ...}


class FirmCrmEngagement(Base, FirmMixin, TimestampMixin):
    """Won work: the matter / engagement. Hand-off point to PSA / practice management."""

    __tablename__ = "firmcrm_engagements"
    __table_args__ = (Index("firmcrm_uq_engagements_opportunity", "firm_id", "opportunity_id", unique=True),)
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    account_id: Mapped[int] = mapped_column(ForeignKey("firmcrm_accounts.id"))
    opportunity_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_opportunities.id"))
    practice_area_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_practice_areas.id"))
    responsible_partner_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    originating_partner_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active|completed|on_hold|terminated
    fee_type: Mapped[str] = mapped_column(String(20), default="hourly")
    annual_value: Mapped[float] = mapped_column(Float, default=0.0)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    adverse_parties: Mapped[list | None] = mapped_column(JSON, default=list)
    external_ref: Mapped[str | None] = mapped_column(String(80))  # PSA / matter number
    account: Mapped[FirmCrmAccount] = relationship(foreign_keys=[account_id])


class FirmCrmCampaign(Base, FirmMixin, TimestampMixin, ArchiveMixin):
    __tablename__ = "firmcrm_campaigns"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(30), default="event")  # event|webinar|newsletter|seminar|sponsorship|content|other
    status: Mapped[str] = mapped_column(String(20), default="planned")  # planned|active|completed
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    budget: Mapped[float] = mapped_column(Float, default=0.0)
    actual_cost: Mapped[float] = mapped_column(Float, default=0.0)
    owner_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    practice_area_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_practice_areas.id"))
    description: Mapped[str | None] = mapped_column(Text)
    members: Mapped[list[FirmCrmCampaignMember]] = relationship(back_populates="campaign", cascade="all, delete-orphan")


class FirmCrmCampaignMember(Base, FirmMixin):
    __tablename__ = "firmcrm_campaign_members"
    __table_args__ = (UniqueConstraint("firm_id", "campaign_id", "contact_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("firmcrm_campaigns.id"))
    contact_id: Mapped[int] = mapped_column(ForeignKey("firmcrm_contacts.id"))
    status: Mapped[str] = mapped_column(String(20), default="invited")  # invited|registered|attended|responded|no_show
    added_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    campaign: Mapped[FirmCrmCampaign] = relationship(back_populates="members")
    contact: Mapped[FirmCrmContact] = relationship()


class FirmCrmEthicalWall(Base, FirmMixin, TimestampMixin):
    """Record-level restriction. While active, the walled account/opportunity (and everything hanging off it) is
    visible only to members (and admins when ADMIN_BYPASSES_WALLS is true). Conflict search still matches the
    walled parties but redacts matter context for non-members."""

    __tablename__ = "firmcrm_ethical_walls"
    __table_args__ = (Index("firmcrm_ix_ethical_walls_entity", "firm_id", "entity_type", "entity_id", "is_active"),
                      Index("firmcrm_uq_active_wall", "firm_id", "entity_type", "entity_id", unique=True, postgresql_where=text("is_active = true"), sqlite_where=text("is_active = 1")),)
    id: Mapped[int] = mapped_column(primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(20))  # account|opportunity
    entity_id: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    created_by_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime)
    deactivated_by_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    members: Mapped[list[FirmCrmEthicalWallMember]] = relationship(back_populates="wall", cascade="all, delete-orphan")


class FirmCrmEthicalWallMember(Base, FirmMixin):
    __tablename__ = "firmcrm_ethical_wall_members"
    __table_args__ = (UniqueConstraint("firm_id", "wall_id", "user_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    wall_id: Mapped[int] = mapped_column(ForeignKey("firmcrm_ethical_walls.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(128), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    added_by_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    added_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    wall: Mapped[FirmCrmEthicalWall] = relationship(back_populates="members")
    user: Mapped[FirmCrmUser] = relationship(primaryjoin="and_(FirmCrmEthicalWallMember.user_id == foreign(FirmCrmUser.id), FirmCrmEthicalWallMember.firm_id == foreign(FirmCrmUser.firm_id))", uselist=False, viewonly=True)


class FirmCrmImportJob(Base, FirmMixin):
    """CSV import run. Source file is never modified; row-level exceptions are retained for review."""

    __tablename__ = "firmcrm_import_jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    entity: Mapped[str] = mapped_column(String(30))  # accounts|contacts|leads
    filename: Mapped[str] = mapped_column(String(255))
    dry_run: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default="completed")  # completed|failed
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    created_rows: Mapped[int] = mapped_column(Integer, default=0)
    updated_rows: Mapped[int] = mapped_column(Integer, default=0)
    skipped_rows: Mapped[int] = mapped_column(Integer, default=0)
    exceptions: Mapped[list] = mapped_column(JSON, default=list)  # [{row, field, message, data}]
    actor_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class FirmCrmAuditLog(Base, FirmMixin):
    __tablename__ = "firmcrm_audit_log"
    account_id: Mapped[int | None] = mapped_column(Integer, index=True)
    opportunity_id: Mapped[int | None] = mapped_column(Integer, index=True)
    contact_id: Mapped[int | None] = mapped_column(Integer, index=True)
    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    actor_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(60))
    entity_type: Mapped[str] = mapped_column(String(40), index=True)
    entity_id: Mapped[str | None] = mapped_column(String(40), index=True)
    before_json: Mapped[str | None] = mapped_column(Text)
    after_json: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(String(255))


# ---- billing

class FirmCrmBillingProfile(Base, FirmMixin, TimestampMixin, ArchiveMixin):
    """Issuer identity and wire instructions printed on invoices. The account number is encrypted at rest."""

    __tablename__ = "firmcrm_billing_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(120))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    issuer_name: Mapped[str] = mapped_column(String(200))
    address_line1: Mapped[str | None] = mapped_column(String(200))
    address_line2: Mapped[str | None] = mapped_column(String(200))
    city: Mapped[str | None] = mapped_column(String(80))
    state: Mapped[str | None] = mapped_column(String(40))
    postal_code: Mapped[str | None] = mapped_column(String(20))
    country: Mapped[str | None] = mapped_column(String(40))
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(255))
    website: Mapped[str | None] = mapped_column(String(255))
    accent_color: Mapped[str] = mapped_column(String(7), default="#1683DB")
    bank_name: Mapped[str | None] = mapped_column(String(200))
    account_name: Mapped[str | None] = mapped_column(String(200))
    routing_number: Mapped[str | None] = mapped_column(String(40))
    swift_code: Mapped[str | None] = mapped_column(String(20))
    account_number_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    account_number_last4: Mapped[str | None] = mapped_column(String(4))
    default_terms_days: Mapped[int] = mapped_column(Integer, default=30)
    default_terms_text: Mapped[str] = mapped_column(String(500), default="Please pay invoice by {due_date}")
    email_subject_template: Mapped[str] = mapped_column(String(300), default="Invoice {invoice_number} from {issuer_name}")
    email_message_template: Mapped[str] = mapped_column(
        Text, default="Hello,\n\nPlease find invoice {invoice_number} for {total} attached, due {due_date}.\n\nThank you,\n{issuer_name}")
    footer_note: Mapped[str | None] = mapped_column(Text)

    def set_account_number(self, value: str | None) -> None:
        from services.encryption_service import encryption_service
        digits = (value or "").strip()
        self.account_number_ciphertext = encryption_service.encrypt_token(digits) if digits else None
        self.account_number_last4 = digits[-4:] if digits else None

    def get_account_number(self) -> str | None:
        from services.encryption_service import encryption_service
        return encryption_service.decrypt_token(self.account_number_ciphertext) if self.account_number_ciphertext else None


class FirmCrmInvoice(Base, FirmMixin, TimestampMixin):
    __tablename__ = "firmcrm_invoices"
    __table_args__ = (UniqueConstraint("firm_id", "number", name="firmcrm_uq_invoices_number"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str | None] = mapped_column(String(40))  # allocated on issue
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)  # draft|issued|sent|paid|void
    billing_profile_id: Mapped[int] = mapped_column(ForeignKey("firmcrm_billing_profiles.id"))
    account_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_accounts.id"), index=True)
    engagement_id: Mapped[int | None] = mapped_column(ForeignKey("firmcrm_engagements.id"))
    billed_to_name: Mapped[str] = mapped_column(String(200))
    billed_to_address: Mapped[str | None] = mapped_column(Text)
    billed_to_email: Mapped[str | None] = mapped_column(String(255))
    billed_to_cc: Mapped[str | None] = mapped_column(String(500))
    issue_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    terms_text: Mapped[str | None] = mapped_column(String(500))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"))
    total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"))
    notes: Mapped[str | None] = mapped_column(Text)
    # Frozen at issue so later profile edits never change an issued invoice.
    issuer_snapshot: Mapped[dict | None] = mapped_column(JSON)
    account_number_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime)
    void_reason: Mapped[str | None] = mapped_column(String(500))
    created_by_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))

    lines: Mapped[list[FirmCrmInvoiceLine]] = relationship(back_populates="invoice", order_by="FirmCrmInvoiceLine.position",
                                                          cascade="all, delete-orphan")
    deliveries: Mapped[list[FirmCrmInvoiceDelivery]] = relationship(order_by="FirmCrmInvoiceDelivery.id",
                                                                   cascade="all, delete-orphan")


class FirmCrmInvoiceLine(Base, FirmMixin):
    __tablename__ = "firmcrm_invoice_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("firmcrm_invoices.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(String(500))
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    invoice: Mapped[FirmCrmInvoice] = relationship(back_populates="lines")


class FirmCrmInvoiceDelivery(Base, FirmMixin):
    __tablename__ = "firmcrm_invoice_deliveries"
    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("firmcrm_invoices.id", ondelete="CASCADE"), index=True)
    to_email: Mapped[str] = mapped_column(String(255))
    cc: Mapped[str | None] = mapped_column(String(500))
    subject: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(20))  # sent|failed
    error: Mapped[str | None] = mapped_column(String(1000))
    sent_by_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


User = FirmCrmUser
PracticeArea = FirmCrmPracticeArea
Pipeline = FirmCrmPipeline
Stage = FirmCrmStage
Account = FirmCrmAccount
Contact = FirmCrmContact
Lead = FirmCrmLead
Opportunity = FirmCrmOpportunity
StageHistory = FirmCrmStageHistory
Activity = FirmCrmActivity
ConflictCheck = FirmCrmConflictCheck
Engagement = FirmCrmEngagement
Campaign = FirmCrmCampaign
CampaignMember = FirmCrmCampaignMember
EthicalWall = FirmCrmEthicalWall
EthicalWallMember = FirmCrmEthicalWallMember
ImportJob = FirmCrmImportJob
AuditLog = FirmCrmAuditLog
BillingProfile = FirmCrmBillingProfile
Invoice = FirmCrmInvoice
InvoiceLine = FirmCrmInvoiceLine
InvoiceDelivery = FirmCrmInvoiceDelivery

class FirmCrmSettings(Base):
    __tablename__ = "firmcrm_settings"
    firm_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("firms.id", ondelete="CASCADE"), primary_key=True)
    access_revision: Mapped[int] = mapped_column(Integer, default=0)
    default_currency: Mapped[str] = mapped_column(String(3), default="USD")
    stale_opportunity_days: Mapped[int] = mapped_column(Integer, default=21)
    conflict_match_threshold: Mapped[float] = mapped_column(Float, default=0.82)
    admin_bypasses_walls: Mapped[bool] = mapped_column(Boolean, default=True)
    next_invoice_number: Mapped[int] = mapped_column(Integer, default=1)
    invoice_number_width: Mapped[int] = mapped_column(Integer, default=5)

CRM_MODELS = [value for key, value in list(globals().items()) if key.startswith("FirmCrm") and isinstance(value, type)]
