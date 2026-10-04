"""Single source of truth for enumerated values. Schemas use Literal[...] built from these tuples;
the frontend mirrors them in src/lib/options.ts (kept in sync by tests/test_enums_sync.py)."""

from __future__ import annotations

from typing import Literal

ROLES = ("admin", "partner", "manager", "staff", "marketing")
DISCIPLINES = ("accounting", "legal", "advisory", "other")
CLEARANCE_TYPES = ("conflict", "independence")
ACCOUNT_TYPES = ("prospect", "client", "former_client", "referral_source", "adverse_party", "vendor", "other")
ENTITY_KINDS = ("company", "individual", "trust", "estate")
RISK = ("low", "medium", "high")
CONTACT_ROLES = ("decision_maker", "influencer", "champion", "gatekeeper", "referral_source", "other")
LIFECYCLES = ("lead", "prospect", "client", "referral_source", "other")
LEAD_SOURCES = ("web", "referral", "event", "webinar", "cold", "partner", "other")
LEAD_STATUSES = ("new", "contacted", "qualified", "unqualified")
LEAD_STATUSES_ALL = LEAD_STATUSES + ("converted",)
FEE_TYPES = ("hourly", "fixed", "retainer", "recurring", "contingency", "value")
EL_STATUSES = ("not_started", "drafted", "sent", "signed")
OPP_STATUSES = ("open", "won", "lost")
ACTIVITY_KINDS = ("call", "email", "meeting", "note", "task")
PRIORITIES = ("low", "normal", "high")
CHECK_STATUSES = ("pending", "clear", "conflict", "waived")
RESOLVE_STATUSES = ("clear", "conflict", "waived")
ENGAGEMENT_STATUSES = ("active", "completed", "on_hold", "terminated")
CAMPAIGN_KINDS = ("event", "webinar", "newsletter", "seminar", "sponsorship", "content", "other")
CAMPAIGN_STATUSES = ("planned", "active", "completed")
MEMBER_STATUSES = ("invited", "registered", "attended", "responded", "no_show")
INVOICE_STATUSES = ("draft", "issued", "sent", "paid", "void")
LOST_REASONS = ("price", "selected competitor", "no decision", "timing", "conflict", "scope change", "other")

Role = Literal["admin", "partner", "manager", "staff", "marketing"]
Discipline = Literal["accounting", "legal", "advisory", "other"]
ClearanceType = Literal["conflict", "independence"]
AccountType = Literal["prospect", "client", "former_client", "referral_source", "adverse_party", "vendor", "other"]
EntityKind = Literal["company", "individual", "trust", "estate"]
Risk = Literal["low", "medium", "high"]
ContactRole = Literal["decision_maker", "influencer", "champion", "gatekeeper", "referral_source", "other"]
Lifecycle = Literal["lead", "prospect", "client", "referral_source", "other"]
LeadSource = Literal["web", "referral", "event", "webinar", "cold", "partner", "other"]
LeadStatus = Literal["new", "contacted", "qualified", "unqualified"]
FeeType = Literal["hourly", "fixed", "retainer", "recurring", "contingency", "value"]
ELStatus = Literal["not_started", "drafted", "sent", "signed"]
ActivityKind = Literal["call", "email", "meeting", "note", "task"]
Priority = Literal["low", "normal", "high"]
CheckType = Literal["conflict", "independence"]
ResolveStatus = Literal["clear", "conflict", "waived"]
EngagementStatus = Literal["active", "completed", "on_hold", "terminated"]
CampaignKind = Literal["event", "webinar", "newsletter", "seminar", "sponsorship", "content", "other"]
CampaignStatus = Literal["planned", "active", "completed"]
MemberStatus = Literal["invited", "registered", "attended", "responded", "no_show"]
LostReason = Literal["price", "selected competitor", "no decision", "timing", "conflict", "scope change", "other"]
InvoiceStatus = Literal["draft", "issued", "sent", "paid", "void"]
