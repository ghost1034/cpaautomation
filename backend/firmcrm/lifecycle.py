"""Integrate CRM with platform firm export and purge operations."""
from sqlalchemy import inspect, select, delete, update
from firmcrm import models as m
from firmcrm.core.db import CrmSession, refresh_visibility
from firmcrm.services.visibility import redact_matches
from models.db_models import User as PlatformUser


def export_firm_crm(db, firm_id, actor_user_id):
    if not inspect(db.connection()).has_table('firmcrm_settings'):
        return {}
    with CrmSession(bind=db.connection(), join_transaction_mode='create_savepoint', info={'firm_id':firm_id}) as crm:
        settings = crm.get(m.FirmCrmSettings, firm_id)
        if settings is None:
            return {}
        actor = crm.get(m.User, actor_user_id)
        platform = crm.get(PlatformUser, actor_user_id)
        if platform is None or platform.firm_id != firm_id:
            return {}
        if actor is not None and not actor.is_active:
            return {}
        if actor is None:
            actor = m.User(id=actor_user_id, firm_id=firm_id, role='staff')
        if getattr(platform.role,'value',platform.role) == 'admin':
            from sqlalchemy.orm.attributes import set_committed_value
            set_committed_value(actor,'role','admin')
        actor._settings = settings
        crm.info.update(actor=actor,settings=settings)
        refresh_visibility(crm)
        result = {}
        for model in m.CRM_MODELS:
            values=[]
            for row in crm.scalars(select(model)).all():
                # Encrypted bank details never leave the database in an export.
                data = {column.name:getattr(row,column.name) for column in model.__table__.columns if not column.name.endswith('_ciphertext')}
                if isinstance(row,m.ConflictCheck):
                    data['matches'] = redact_matches(crm,actor,row.matches)
                values.append(data)
            result[model.__tablename__.removeprefix('firmcrm_')] = values
        return result


def purge_firm_crm(db, firm_id):
    if not inspect(db.connection()).has_table('firmcrm_settings'):
        return
    # Break nullable cycles first, then delete children before referenced rows.
    db.execute(update(m.Account.__table__).where(m.Account.firm_id == firm_id).values(referral_contact_id=None,referral_account_id=None))
    db.execute(update(m.Lead.__table__).where(m.Lead.firm_id == firm_id).values(converted_opportunity_id=None,converted_account_id=None,converted_contact_id=None))
    order=[m.AuditLog,m.ImportJob,m.InvoiceDelivery,m.InvoiceLine,m.Invoice,m.BillingProfile,m.EthicalWallMember,m.EthicalWall,m.StageHistory,m.ConflictCheck,m.Activity,m.CampaignMember,m.Engagement,m.Lead,m.Opportunity,m.Contact,m.Account,m.Campaign,m.User,m.Stage,m.Pipeline,m.PracticeArea,m.FirmCrmSettings]
    for model in order:
        db.execute(delete(model.__table__).where(model.firm_id==firm_id))
