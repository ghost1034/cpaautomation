"""Move saved Tasklytic Gemini 3.1 Pro selections to Gemini 4 Argon.

Revision ID: 086_tasklytic_argon_model
Revises: 085_firmcrm_billing
"""

from alembic import op
import sqlalchemy as sa


revision = "086_tasklytic_argon_model"
down_revision = "085_firmcrm_billing"
branch_labels = None
depends_on = None

# The legacy ID is retained only to migrate existing saved settings.
LEGACY_MODEL = "gemini-3.1-pro-preview"
MODEL = "gemini-4-argon"


def upgrade() -> None:
    settings = sa.table("tasklytic_ai_settings", sa.column("model", sa.String(64)))
    op.execute(settings.update().where(settings.c.model == LEGACY_MODEL).values(model=MODEL))


def downgrade() -> None:
    # The legacy model is no longer offered; preserve saved selections.
    pass
