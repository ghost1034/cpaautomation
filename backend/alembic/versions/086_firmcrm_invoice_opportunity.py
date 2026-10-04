"""FirmCRM billing: link invoices to the opportunity they were generated from.

Revision ID: 086_firmcrm_invoice_opportunity
Revises: 085_firmcrm_billing
"""

from alembic import op
import sqlalchemy as sa


revision = "086_firmcrm_invoice_opportunity"
down_revision = "085_firmcrm_billing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("firmcrm_invoices", sa.Column("opportunity_id", sa.Integer(), nullable=True))
    op.create_foreign_key("firmcrm_fk_invoices_opportunity_id_opportunities", "firmcrm_invoices", "firmcrm_opportunities",
                          ["opportunity_id"], ["id"])
    op.create_index(op.f("ix_firmcrm_invoices_opportunity_id"), "firmcrm_invoices", ["opportunity_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_firmcrm_invoices_opportunity_id"), table_name="firmcrm_invoices")
    op.drop_constraint("firmcrm_fk_invoices_opportunity_id_opportunities", "firmcrm_invoices", type_="foreignkey")
    op.drop_column("firmcrm_invoices", "opportunity_id")
