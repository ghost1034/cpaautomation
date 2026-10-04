"""FirmCRM billing: billing profiles, invoices, line items and email deliveries.

Revision ID: 085_firmcrm_billing
Revises: 084_esign_reminder_links
"""

from alembic import op
import sqlalchemy as sa


revision = "085_firmcrm_billing"
down_revision = "084_esign_reminder_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("firmcrm_accounts", sa.Column("postal_code", sa.String(length=20), nullable=True))
    op.add_column("firmcrm_settings", sa.Column("next_invoice_number", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("firmcrm_settings", sa.Column("invoice_number_width", sa.Integer(), nullable=False, server_default="5"))

    op.create_table(
        "firmcrm_billing_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("issuer_name", sa.String(length=200), nullable=False),
        sa.Column("address_line1", sa.String(length=200), nullable=True),
        sa.Column("address_line2", sa.String(length=200), nullable=True),
        sa.Column("city", sa.String(length=80), nullable=True),
        sa.Column("state", sa.String(length=40), nullable=True),
        sa.Column("postal_code", sa.String(length=20), nullable=True),
        sa.Column("country", sa.String(length=40), nullable=True),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("website", sa.String(length=255), nullable=True),
        sa.Column("accent_color", sa.String(length=7), nullable=False),
        sa.Column("bank_name", sa.String(length=200), nullable=True),
        sa.Column("account_name", sa.String(length=200), nullable=True),
        sa.Column("routing_number", sa.String(length=40), nullable=True),
        sa.Column("swift_code", sa.String(length=20), nullable=True),
        sa.Column("account_number_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("account_number_last4", sa.String(length=4), nullable=True),
        sa.Column("default_terms_days", sa.Integer(), nullable=False),
        sa.Column("default_terms_text", sa.String(length=500), nullable=False),
        sa.Column("email_subject_template", sa.String(length=300), nullable=False),
        sa.Column("email_message_template", sa.Text(), nullable=False),
        sa.Column("footer_note", sa.Text(), nullable=True),
        sa.Column("firm_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("is_archived", sa.Boolean(), nullable=False),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["firm_id"], ["firms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_firmcrm_billing_profiles_firm_id"), "firmcrm_billing_profiles", ["firm_id"], unique=False)
    op.create_index(op.f("ix_firmcrm_billing_profiles_is_archived"), "firmcrm_billing_profiles", ["is_archived"], unique=False)

    op.create_table(
        "firmcrm_invoices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("number", sa.String(length=40), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("billing_profile_id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=True),
        sa.Column("engagement_id", sa.Integer(), nullable=True),
        sa.Column("billed_to_name", sa.String(length=200), nullable=False),
        sa.Column("billed_to_address", sa.Text(), nullable=True),
        sa.Column("billed_to_email", sa.String(length=255), nullable=True),
        sa.Column("billed_to_cc", sa.String(length=500), nullable=True),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("terms_text", sa.String(length=500), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("subtotal", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("total", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("issuer_snapshot", sa.JSON(), nullable=True),
        sa.Column("account_number_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("issued_at", sa.DateTime(), nullable=True),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("paid_at", sa.DateTime(), nullable=True),
        sa.Column("voided_at", sa.DateTime(), nullable=True),
        sa.Column("void_reason", sa.String(length=500), nullable=True),
        sa.Column("created_by_id", sa.String(length=128), nullable=True),
        sa.Column("firm_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["firmcrm_accounts.id"]),
        sa.ForeignKeyConstraint(["billing_profile_id"], ["firmcrm_billing_profiles.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["engagement_id"], ["firmcrm_engagements.id"]),
        sa.ForeignKeyConstraint(["firm_id"], ["firms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("firm_id", "number", name="firmcrm_uq_invoices_number"),
    )
    op.create_index(op.f("ix_firmcrm_invoices_firm_id"), "firmcrm_invoices", ["firm_id"], unique=False)
    op.create_index(op.f("ix_firmcrm_invoices_status"), "firmcrm_invoices", ["status"], unique=False)
    op.create_index(op.f("ix_firmcrm_invoices_account_id"), "firmcrm_invoices", ["account_id"], unique=False)

    op.create_table(
        "firmcrm_invoice_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("unit_cost", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("firm_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["firm_id"], ["firms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invoice_id"], ["firmcrm_invoices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_firmcrm_invoice_lines_firm_id"), "firmcrm_invoice_lines", ["firm_id"], unique=False)
    op.create_index(op.f("ix_firmcrm_invoice_lines_invoice_id"), "firmcrm_invoice_lines", ["invoice_id"], unique=False)

    op.create_table(
        "firmcrm_invoice_deliveries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("to_email", sa.String(length=255), nullable=False),
        sa.Column("cc", sa.String(length=500), nullable=True),
        sa.Column("subject", sa.String(length=300), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error", sa.String(length=1000), nullable=True),
        sa.Column("sent_by_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("firm_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["firm_id"], ["firms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invoice_id"], ["firmcrm_invoices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sent_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_firmcrm_invoice_deliveries_firm_id"), "firmcrm_invoice_deliveries", ["firm_id"], unique=False)
    op.create_index(op.f("ix_firmcrm_invoice_deliveries_invoice_id"), "firmcrm_invoice_deliveries", ["invoice_id"], unique=False)


def downgrade() -> None:
    op.drop_table("firmcrm_invoice_deliveries")
    op.drop_table("firmcrm_invoice_lines")
    op.drop_table("firmcrm_invoices")
    op.drop_table("firmcrm_billing_profiles")
    op.drop_column("firmcrm_settings", "invoice_number_width")
    op.drop_column("firmcrm_settings", "next_invoice_number")
    op.drop_column("firmcrm_accounts", "postal_code")
