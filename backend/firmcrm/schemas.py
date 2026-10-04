"""Pydantic request/response schemas."""

from __future__ import annotations

from uuid import UUID
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Literal, Annotated, Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_serializer

from firmcrm.enums import (
    AccountType,
    ActivityKind,
    CampaignKind,
    CampaignStatus,
    CheckType,
    ClearanceType,
    ContactRole,
    Discipline,
    ELStatus,
    EngagementStatus,
    EntityKind,
    FeeType,
    InvoiceStatus,
    LeadSource,
    LeadStatus,
    Lifecycle,
    LostReason,
    MemberStatus,
    Priority,
    ResolveStatus,
    Risk,
    Role,
)

T = TypeVar("T")

S = Annotated[str, Field(max_length=200)]  # short text
M = Annotated[str, Field(max_length=500)]  # medium text
L = Annotated[str, Field(max_length=5000)]  # long text / notes


class FirmCrmORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("*", mode="wrap", when_used="json", check_fields=False)
    def serialize_utc(self, value, handler):
        if isinstance(value, datetime):
            return value.replace(tzinfo=value.tzinfo or UTC).isoformat()
        return handler(value)


class FirmCrmPage(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


# ---- auth / users

class FirmCrmUserOut(FirmCrmORM):
    id: str
    email: str
    full_name: str
    role: Role
    title: str | None = None
    practice_area_id: int | None = None
    is_active: bool
    last_login_at: datetime | None = None





# ---- reference data
class FirmCrmPracticeAreaIn(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    discipline: Discipline = "other"
    clearance_type: ClearanceType | None = None
    is_active: bool = True


class FirmCrmPracticeAreaOut(FirmCrmPracticeAreaIn, FirmCrmORM):
    id: int


class FirmCrmStageIn(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    position: int = 0
    probability: int = Field(default=10, ge=0, le=100)
    is_won: bool = False
    is_lost: bool = False


class FirmCrmStageOut(FirmCrmStageIn, FirmCrmORM):
    id: int
    pipeline_id: int


class FirmCrmPipelineOut(FirmCrmORM):
    id: int
    name: str
    is_default: bool
    stages: list[FirmCrmStageOut]


class FirmCrmPipelineIn(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    is_default: bool = False
    stages: list[FirmCrmStageIn]


# ---- accounts
class FirmCrmAccountBase(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    aliases: M | None = None
    account_type: AccountType = "prospect"
    entity_kind: EntityKind = "company"
    industry: Annotated[str, Field(max_length=80)] | None = None
    website: Annotated[str, Field(max_length=255)] | None = None
    phone: Annotated[str, Field(max_length=40)] | None = None
    address: Annotated[str, Field(max_length=255)] | None = None
    city: Annotated[str, Field(max_length=80)] | None = None
    state: Annotated[str, Field(max_length=40)] | None = None
    postal_code: Annotated[str, Field(max_length=20)] | None = None
    country: Annotated[str, Field(max_length=40)] = "US"
    revenue_band: Annotated[str, Field(max_length=40)] | None = None
    employee_band: Annotated[str, Field(max_length=40)] | None = None
    owner_id: str | None = None
    originating_partner_id: str | None = None
    referral_account_id: int | None = None
    referral_contact_id: int | None = None
    client_since: date | None = None
    risk_rating: Risk | None = None
    is_public_company: bool = False
    tags: list[Annotated[str, Field(max_length=40)]] = Field(default_factory=list, max_length=30)
    description: L | None = None


class FirmCrmAccountCreate(FirmCrmAccountBase):
    allow_duplicate: bool = False  # override the duplicate-name guard


class FirmCrmAccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    aliases: M | None = None
    account_type: AccountType | None = None
    entity_kind: EntityKind | None = None
    industry: Annotated[str, Field(max_length=80)] | None = None
    website: Annotated[str, Field(max_length=255)] | None = None
    phone: Annotated[str, Field(max_length=40)] | None = None
    address: Annotated[str, Field(max_length=255)] | None = None
    city: Annotated[str, Field(max_length=80)] | None = None
    state: Annotated[str, Field(max_length=40)] | None = None
    postal_code: Annotated[str, Field(max_length=20)] | None = None
    country: Annotated[str, Field(max_length=40)] | None = None
    revenue_band: Annotated[str, Field(max_length=40)] | None = None
    employee_band: Annotated[str, Field(max_length=40)] | None = None
    owner_id: str | None = None
    originating_partner_id: str | None = None
    referral_account_id: int | None = None
    referral_contact_id: int | None = None
    client_since: date | None = None
    risk_rating: Risk | None = None
    is_public_company: bool | None = None
    tags: list[Annotated[str, Field(max_length=40)]] | None = Field(default=None, max_length=30)
    description: L | None = None


class FirmCrmAccountOut(FirmCrmAccountBase, FirmCrmORM):
    shared_client_id: UUID | None = None
    id: int
    is_archived: bool = False
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    owner_name: str | None = None
    originating_partner_name: str | None = None
    open_pipeline: float = 0.0
    contact_count: int = 0
    engagement_count: int = 0
    last_activity_at: datetime | None = None


# ---- contacts
class FirmCrmContactBase(BaseModel):
    first_name: Annotated[str, Field(min_length=1, max_length=80)]
    last_name: Annotated[str, Field(min_length=1, max_length=80)]
    email: EmailStr | None = None
    phone: Annotated[str, Field(max_length=40)] | None = None
    title: Annotated[str, Field(max_length=120)] | None = None
    account_id: int | None = None
    role: ContactRole | None = None
    owner_id: str | None = None
    lifecycle: Lifecycle = "lead"
    do_not_contact: bool = False
    linkedin: Annotated[str, Field(max_length=255)] | None = None
    notes: L | None = None


class FirmCrmContactCreate(FirmCrmContactBase):
    pass


class FirmCrmContactUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    first_name: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    last_name: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    email: EmailStr | None = None
    phone: Annotated[str, Field(max_length=40)] | None = None
    title: Annotated[str, Field(max_length=120)] | None = None
    account_id: int | None = None
    role: ContactRole | None = None
    owner_id: str | None = None
    lifecycle: Lifecycle | None = None
    do_not_contact: bool | None = None
    linkedin: Annotated[str, Field(max_length=255)] | None = None
    notes: L | None = None


class FirmCrmContactOut(FirmCrmContactBase, FirmCrmORM):
    id: int
    is_archived: bool = False
    full_name: str
    account_name: str | None = None
    owner_name: str | None = None
    last_activity_at: datetime | None = None
    created_at: datetime


# ---- leads
class FirmCrmLeadBase(BaseModel):
    first_name: Annotated[str, Field(min_length=1, max_length=80)]
    last_name: Annotated[str, Field(min_length=1, max_length=80)]
    company: S | None = None
    email: EmailStr | None = None
    phone: Annotated[str, Field(max_length=40)] | None = None
    title: Annotated[str, Field(max_length=120)] | None = None
    source: LeadSource = "web"
    status: LeadStatus = "new"
    practice_area_id: int | None = None
    owner_id: str | None = None
    campaign_id: int | None = None
    referral_contact_id: int | None = None
    estimated_value: Annotated[float, Field(ge=0)] | None = None
    need_summary: L | None = None
    score: Annotated[int, Field(ge=0, le=100)] = 0
    unqualified_reason: S | None = None


class FirmCrmLeadCreate(FirmCrmLeadBase):
    pass


class FirmCrmLeadUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    first_name: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    last_name: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    company: S | None = None
    email: EmailStr | None = None
    phone: Annotated[str, Field(max_length=40)] | None = None
    title: Annotated[str, Field(max_length=120)] | None = None
    source: LeadSource | None = None
    status: LeadStatus | None = None
    practice_area_id: int | None = None
    owner_id: str | None = None
    campaign_id: int | None = None
    referral_contact_id: int | None = None
    estimated_value: Annotated[float, Field(ge=0)] | None = None
    need_summary: L | None = None
    score: Annotated[int, Field(ge=0, le=100)] | None = None
    unqualified_reason: S | None = None


class FirmCrmLeadOut(FirmCrmLeadBase, FirmCrmORM):
    id: int
    status: str  # may be "converted"
    is_archived: bool = False
    owner_name: str | None = None
    practice_area_name: str | None = None
    converted_account_id: int | None = None
    converted_contact_id: int | None = None
    converted_opportunity_id: int | None = None
    converted_at: datetime | None = None
    created_at: datetime


class FirmCrmLeadConvertIn(BaseModel):
    existing_account_id: int | None = None  # attach to existing account instead of creating
    create_opportunity: bool = True
    opportunity_name: S | None = None
    amount: Annotated[float, Field(ge=0)] | None = None
    pipeline_id: int | None = None
    expected_close: date | None = None


class FirmCrmLeadConvertOut(BaseModel):
    account_id: int
    contact_id: int
    opportunity_id: int | None


# ---- opportunities
class FirmCrmOpportunityBase(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    account_id: int
    primary_contact_id: int | None = None
    pipeline_id: int | None = None
    stage_id: int | None = None
    practice_area_id: int | None = None
    owner_id: str | None = None
    originating_partner_id: str | None = None
    responsible_partner_id: str | None = None
    referral_contact_id: int | None = None
    referral_account_id: int | None = None
    campaign_id: int | None = None
    amount: Annotated[float, Field(ge=0)] = 0.0
    fee_type: FeeType = "hourly"
    is_recurring: bool = False
    probability: Annotated[int, Field(ge=0, le=100)] | None = None
    expected_close: date | None = None
    proposal_due: date | None = None
    engagement_letter_status: ELStatus = "not_started"
    competitor: Annotated[str, Field(max_length=120)] | None = None
    adverse_parties: list[S] = Field(default_factory=list, max_length=50)
    description: L | None = None
    next_step: Annotated[str, Field(max_length=255)] | None = None


class FirmCrmOpportunityCreate(FirmCrmOpportunityBase):
    pass


class FirmCrmOpportunityUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    primary_contact_id: int | None = None
    practice_area_id: int | None = None
    owner_id: str | None = None
    originating_partner_id: str | None = None
    responsible_partner_id: str | None = None
    referral_contact_id: int | None = None
    referral_account_id: int | None = None
    campaign_id: int | None = None
    amount: Annotated[float, Field(ge=0)] | None = None
    fee_type: FeeType | None = None
    is_recurring: bool | None = None
    probability: int | None = Field(default=None, ge=0, le=100)
    expected_close: date | None = None
    proposal_due: date | None = None
    engagement_letter_status: ELStatus | None = None
    competitor: Annotated[str, Field(max_length=120)] | None = None
    adverse_parties: list[S] | None = Field(default=None, max_length=50)
    description: L | None = None
    next_step: Annotated[str, Field(max_length=255)] | None = None


class FirmCrmStageChangeIn(BaseModel):
    stage_id: int
    lost_reason: LostReason | None = None
    competitor: Annotated[str, Field(max_length=120)] | None = None
    note: M | None = None


class FirmCrmOpportunityOut(FirmCrmOpportunityBase, FirmCrmORM):
    stage_id: int
    pipeline_id: int
    probability: int
    id: int
    is_archived: bool = False
    status: Literal["open", "won", "lost"]
    closed_at: datetime | None = None
    lost_reason: str | None = None
    last_activity_at: datetime | None = None
    stage_entered_at: datetime
    created_at: datetime
    updated_at: datetime
    account_name: str | None = None
    stage_name: str | None = None
    stage_position: int | None = None
    practice_area_name: str | None = None
    owner_name: str | None = None
    originating_partner_name: str | None = None
    primary_contact_name: str | None = None
    weighted_amount: float = 0.0
    days_in_stage: int = 0
    is_stale: bool = False
    clearance_type: str | None = None
    clearance_status: str | None = None  # none|pending|clear|conflict|waived


class FirmCrmStageHistoryOut(FirmCrmORM):
    id: int
    from_stage_id: int | None
    to_stage_id: int
    changed_by_id: str | None
    changed_at: datetime
    days_in_previous: float | None
    from_stage_name: str | None = None
    to_stage_name: str | None = None
    changed_by_name: str | None = None


# ---- activities
class FirmCrmActivityBase(BaseModel):
    kind: ActivityKind
    subject: Annotated[str, Field(min_length=1, max_length=200)]
    body: L | None = None
    owner_id: str | None = None
    account_id: int | None = None
    contact_id: int | None = None
    opportunity_id: int | None = None
    lead_id: int | None = None
    due_at: datetime | None = None
    occurred_at: datetime | None = None
    priority: Priority = "normal"


class FirmCrmActivityCreate(FirmCrmActivityBase):
    pass


class FirmCrmActivityUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    body: L | None = None
    owner_id: str | None = None
    due_at: datetime | None = None
    completed: bool | None = None
    priority: Priority | None = None


class FirmCrmActivityOut(FirmCrmActivityBase, FirmCrmORM):
    id: int
    completed_at: datetime | None
    created_at: datetime
    owner_name: str | None = None
    account_name: str | None = None
    contact_name: str | None = None
    opportunity_name: str | None = None
    lead_name: str | None = None


# ---- conflict checks
class FirmCrmConflictSearchIn(BaseModel):
    parties: list[S] = Field(min_length=1, max_length=100)


class FirmCrmConflictMatch(BaseModel):
    party: str
    matched_name: str
    entity: str  # account|contact|adverse_party
    entity_id: int | None
    relationship: str
    context: str | None = None
    score: float
    source_type: str | None = None
    restricted: bool = False


class FirmCrmConflictCheckCreate(BaseModel):
    check_type: CheckType = "conflict"
    opportunity_id: int | None = None
    account_id: int | None = None
    parties: list[S] = Field(min_length=1, max_length=100)
    independence_attestation: dict[str, bool] | None = None


class FirmCrmConflictResolveIn(BaseModel):
    status: ResolveStatus
    resolution_note: L | None = None


class FirmCrmConflictCheckOut(FirmCrmORM):
    id: int
    check_type: str
    opportunity_id: int | None
    account_id: int | None
    requested_by_id: str | None
    parties: list[str]
    matches: list[FirmCrmConflictMatch]
    status: str
    resolution_note: str | None
    resolved_by_id: str | None
    resolved_at: datetime | None
    independence_attestation: dict[str, Any] | None
    created_at: datetime
    requested_by_name: str | None = None
    resolved_by_name: str | None = None
    opportunity_name: str | None = None
    account_name: str | None = None


# ---- engagements
class FirmCrmEngagementBase(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    account_id: int
    opportunity_id: int | None = None
    practice_area_id: int | None = None
    responsible_partner_id: str | None = None
    originating_partner_id: str | None = None
    status: EngagementStatus = "active"
    fee_type: FeeType = "hourly"
    annual_value: Annotated[float, Field(ge=0)] = 0.0
    start_date: date | None = None
    end_date: date | None = None
    adverse_parties: list[S] = Field(default_factory=list, max_length=50)
    external_ref: Annotated[str, Field(max_length=80)] | None = None


class FirmCrmEngagementCreate(FirmCrmEngagementBase):
    pass


class FirmCrmEngagementUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    status: EngagementStatus | None = None
    responsible_partner_id: str | None = None
    fee_type: FeeType | None = None
    annual_value: Annotated[float, Field(ge=0)] | None = None
    start_date: date | None = None
    end_date: date | None = None
    adverse_parties: list[S] | None = Field(default=None, max_length=50)
    external_ref: Annotated[str, Field(max_length=80)] | None = None


class FirmCrmEngagementOut(FirmCrmEngagementBase, FirmCrmORM):
    id: int
    created_at: datetime
    account_name: str | None = None
    practice_area_name: str | None = None
    responsible_partner_name: str | None = None


# ---- campaigns
class FirmCrmCampaignBase(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    kind: CampaignKind = "event"
    status: CampaignStatus = "planned"
    start_date: date | None = None
    end_date: date | None = None
    budget: Annotated[float, Field(ge=0)] = 0.0
    actual_cost: Annotated[float, Field(ge=0)] = 0.0
    owner_id: str | None = None
    practice_area_id: int | None = None
    description: L | None = None


class FirmCrmCampaignCreate(FirmCrmCampaignBase):
    pass


class FirmCrmCampaignUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    kind: CampaignKind | None = None
    status: CampaignStatus | None = None
    start_date: date | None = None
    end_date: date | None = None
    budget: Annotated[float, Field(ge=0)] | None = None
    actual_cost: Annotated[float, Field(ge=0)] | None = None
    owner_id: str | None = None
    practice_area_id: int | None = None
    description: L | None = None


class FirmCrmCampaignOut(FirmCrmCampaignBase, FirmCrmORM):
    id: int
    is_archived: bool = False
    created_at: datetime
    member_count: int = 0
    attended_count: int = 0
    leads_generated: int = 0
    influenced_pipeline: float = 0.0
    won_amount: float = 0.0


class FirmCrmCampaignMemberIn(BaseModel):
    contact_id: int
    status: MemberStatus = "invited"


class FirmCrmCampaignMemberOut(FirmCrmORM):
    id: int
    contact_id: int
    status: str
    added_at: datetime
    contact_name: str | None = None
    contact_email: str | None = None
    account_name: str | None = None


class FirmCrmAuditOut(FirmCrmORM):
    id: int
    at: datetime
    actor_id: str | None
    action: str
    entity_type: str
    entity_id: str | None
    before_json: str | None
    after_json: str | None
    note: str | None
    actor_name: str | None = None


# ---- billing
Hex = Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]
Money = Annotated[Decimal, Field(ge=0, le=Decimal("999999999999.99"), max_digits=14, decimal_places=2)]
Qty = Annotated[Decimal, Field(gt=0, le=Decimal("9999999999.99"), max_digits=12, decimal_places=2)]


class FirmCrmBillingProfileBase(BaseModel):
    label: Annotated[str, Field(min_length=1, max_length=120)]
    is_default: bool = False
    issuer_name: Annotated[str, Field(min_length=1, max_length=200)]
    address_line1: S | None = None
    address_line2: S | None = None
    city: Annotated[str, Field(max_length=80)] | None = None
    state: Annotated[str, Field(max_length=40)] | None = None
    postal_code: Annotated[str, Field(max_length=20)] | None = None
    country: Annotated[str, Field(max_length=40)] | None = None
    phone: Annotated[str, Field(max_length=40)] | None = None
    email: EmailStr | None = None
    website: Annotated[str, Field(max_length=255)] | None = None
    accent_color: Hex = "#1683DB"
    bank_name: S | None = None
    account_name: S | None = None
    routing_number: Annotated[str, Field(max_length=40)] | None = None
    swift_code: Annotated[str, Field(max_length=20)] | None = None
    default_terms_days: Annotated[int, Field(ge=0, le=365)] = 30
    default_terms_text: M = "Please pay invoice by {due_date}"
    email_subject_template: Annotated[str, Field(min_length=1, max_length=300)] = "Invoice {invoice_number} from {issuer_name}"
    email_message_template: L = "Hello,\n\nPlease find invoice {invoice_number} for {total} attached, due {due_date}.\n\nThank you,\n{issuer_name}"
    footer_note: L | None = None


class FirmCrmBillingProfileCreate(FirmCrmBillingProfileBase):
    account_number: Annotated[str, Field(max_length=40)] | None = None  # write-only; stored encrypted


class FirmCrmBillingProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    is_default: bool | None = None
    issuer_name: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    address_line1: S | None = None
    address_line2: S | None = None
    city: Annotated[str, Field(max_length=80)] | None = None
    state: Annotated[str, Field(max_length=40)] | None = None
    postal_code: Annotated[str, Field(max_length=20)] | None = None
    country: Annotated[str, Field(max_length=40)] | None = None
    phone: Annotated[str, Field(max_length=40)] | None = None
    email: EmailStr | None = None
    website: Annotated[str, Field(max_length=255)] | None = None
    accent_color: Hex | None = None
    bank_name: S | None = None
    account_name: S | None = None
    routing_number: Annotated[str, Field(max_length=40)] | None = None
    swift_code: Annotated[str, Field(max_length=20)] | None = None
    account_number: Annotated[str, Field(max_length=40)] | None = None
    default_terms_days: Annotated[int, Field(ge=0, le=365)] | None = None
    default_terms_text: M | None = None
    email_subject_template: Annotated[str, Field(min_length=1, max_length=300)] | None = None
    email_message_template: L | None = None
    footer_note: L | None = None


class FirmCrmBillingProfileOut(FirmCrmBillingProfileBase, FirmCrmORM):
    id: int
    email: str | None = None
    account_number_last4: str | None = None
    is_archived: bool = False
    created_at: datetime
    updated_at: datetime


class FirmCrmInvoiceLineIn(BaseModel):
    description: Annotated[str, Field(min_length=1, max_length=500)]
    unit_cost: Money
    quantity: Qty = Decimal("1")


class FirmCrmInvoiceLineOut(FirmCrmORM):
    id: int
    position: int
    description: str
    unit_cost: Decimal
    quantity: Decimal
    amount: Decimal


class FirmCrmInvoiceCreate(BaseModel):
    billing_profile_id: int
    account_id: int | None = None
    engagement_id: int | None = None
    billed_to_name: Annotated[str, Field(min_length=1, max_length=200)]
    billed_to_address: Annotated[str, Field(max_length=1000)] | None = None
    billed_to_email: EmailStr | None = None
    billed_to_cc: M | None = None
    issue_date: date | None = None
    due_date: date | None = None
    terms_text: M | None = None
    currency: Annotated[str, Field(min_length=3, max_length=3)] = "USD"
    notes: L | None = None
    lines: list[FirmCrmInvoiceLineIn] = Field(default_factory=list, max_length=200)


class FirmCrmInvoiceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    billing_profile_id: int | None = None
    account_id: int | None = None
    engagement_id: int | None = None
    billed_to_name: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    billed_to_address: Annotated[str, Field(max_length=1000)] | None = None
    billed_to_email: EmailStr | None = None
    billed_to_cc: M | None = None
    issue_date: date | None = None
    due_date: date | None = None
    terms_text: M | None = None
    currency: Annotated[str, Field(min_length=3, max_length=3)] | None = None
    notes: L | None = None
    lines: list[FirmCrmInvoiceLineIn] | None = Field(default=None, max_length=200)


class FirmCrmInvoiceDeliveryOut(FirmCrmORM):
    id: int
    to_email: str
    cc: str | None = None
    subject: str
    status: str
    error: str | None = None
    sent_by_id: str | None = None
    created_at: datetime


class FirmCrmInvoiceOut(FirmCrmORM):
    id: int
    number: str | None = None
    status: InvoiceStatus
    billing_profile_id: int
    account_id: int | None = None
    engagement_id: int | None = None
    billed_to_name: str
    billed_to_address: str | None = None
    billed_to_email: str | None = None
    billed_to_cc: str | None = None
    issue_date: date | None = None
    due_date: date | None = None
    terms_text: str | None = None
    currency: str
    subtotal: Decimal
    total: Decimal
    notes: str | None = None
    issued_at: datetime | None = None
    sent_at: datetime | None = None
    paid_at: datetime | None = None
    voided_at: datetime | None = None
    void_reason: str | None = None
    created_by_id: str | None = None
    issuer_snapshot: dict[str, Any] | None = None  # issuer details frozen at issue; never includes the account number
    created_at: datetime
    updated_at: datetime
    account_name: str | None = None
    engagement_name: str | None = None
    billing_profile_label: str | None = None
    lines: list[FirmCrmInvoiceLineOut] = Field(default_factory=list)
    deliveries: list[FirmCrmInvoiceDeliveryOut] = Field(default_factory=list)


class FirmCrmInvoicePrefillOut(BaseModel):
    account_id: int
    billed_to_name: str
    billed_to_address: str | None = None
    billed_to_email: str | None = None


class FirmCrmInvoiceVoidIn(BaseModel):
    reason: M | None = None
