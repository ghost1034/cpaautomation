"""Dedicated CRM sessions: tenant scope and record visibility apply to every ORM read.

Only conflict matching may temporarily include restricted records. That escape
hatch never disables tenant isolation and never returns raw matches to an API.
"""
from contextlib import contextmanager
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy import event, inspect, select, and_, or_, true
from sqlalchemy.orm import Session, with_loader_criteria

from core.database import db_config
from dependencies.auth import verify_firebase_token
from models.db_models import Base, User as PlatformUser, Firm, Client
from firmcrm import models as m
from firmcrm.core.errors import Forbidden, NotFound, Conflict


class CrmSession(Session):
    @contextmanager
    def include_restricted(self):
        previous = self.info.get('include_restricted', False)
        self.info['include_restricted'] = True
        try:
            yield
        finally:
            self.info['include_restricted'] = previous

    def get(self, entity, ident, **kwargs):
        if entity in m.CRM_MODELS:
            stmt = select(entity)
            if entity is m.FirmCrmSettings:
                stmt = stmt.where(entity.firm_id == ident)
            else:
                value = ident[0] if isinstance(ident, tuple) else ident
                stmt = stmt.where(entity.id == value)
            return self.scalars(stmt).first()
        return super().get(entity, ident, **kwargs)


def refresh_visibility(db: CrmSession):
    """Compute the transitive restrictions with explicitly tenant-scoped Core reads."""
    firm = db.info['firm_id']
    actor = db.info.get('actor')
    hidden: dict[str, set] = {}
    if not actor or (actor.role == 'admin' and db.info['settings'].admin_bypasses_walls):
        db.info['hidden'] = hidden
        return
    def rows(model):
        table = model.__table__
        names = {'id','wall_id','user_id','entity_type','entity_id','is_active','account_id','opportunity_id','contact_id','lead_id','converted_account_id','converted_opportunity_id','converted_contact_id','engagement_id','invoice_id'}
        columns = [c for c in table.columns if c.name in names]
        return db.connection().execute(select(*columns).where(table.c.firm_id == firm)).mappings().all()
    walls = rows(m.EthicalWall)
    memberships = rows(m.EthicalWallMember)
    allowed = {r['wall_id'] for r in memberships if r['user_id'] == actor.id}
    ha = {r['entity_id'] for r in walls if r['is_active'] and r['entity_type'] == 'account' and r['id'] not in allowed}
    ho = {r['entity_id'] for r in walls if r['is_active'] and r['entity_type'] == 'opportunity' and r['id'] not in allowed}
    ho |= {r['id'] for r in rows(m.Opportunity) if r['account_id'] in ha}
    hc = {r['id'] for r in rows(m.Contact) if r['account_id'] in ha}
    hl = {r['id'] for r in rows(m.Lead) if r['converted_account_id'] in ha or r['converted_opportunity_id'] in ho or r['converted_contact_id'] in hc}
    hidden.update(account=ha, opportunity=ho, contact=hc, lead=hl)
    for model, kind in [(m.Engagement,'engagement'), (m.Activity,'activity'), (m.ConflictCheck,'conflict_check'), (m.StageHistory,'stage_history'), (m.CampaignMember,'campaign_member'), (m.AuditLog,'audit_log')]:
        hidden[kind] = {r['id'] for r in rows(model) if r.get('account_id') in ha or r.get('opportunity_id') in ho or r.get('contact_id') in hc or r.get('lead_id') in hl}
    hidden['invoice'] = {r['id'] for r in rows(m.Invoice) if r['account_id'] in ha or r['engagement_id'] in hidden['engagement']}
    for model, kind in [(m.InvoiceLine,'invoice_line'), (m.InvoiceDelivery,'invoice_delivery')]:
        hidden[kind] = {r['id'] for r in rows(model) if r['invoice_id'] in hidden['invoice']}
    hidden['ethical_wall'] = {r['id'] for r in walls if (r['entity_type']=='account' and r['entity_id'] in ha) or (r['entity_type']=='opportunity' and r['entity_id'] in ho)}
    db.info['hidden'] = hidden


KINDS = {m.Account:'account', m.Opportunity:'opportunity', m.Contact:'contact', m.Lead:'lead', m.Engagement:'engagement', m.Activity:'activity', m.ConflictCheck:'conflict_check', m.StageHistory:'stage_history', m.CampaignMember:'campaign_member', m.EthicalWall:'ethical_wall', m.Invoice:'invoice', m.InvoiceLine:'invoice_line', m.InvoiceDelivery:'invoice_delivery'}


@event.listens_for(CrmSession, 'do_orm_execute')
def scope_reads(state):
    db = state.session
    if not state.is_select:
        # Domain writes use the unit of work so validation cannot be skipped.
        raise RuntimeError('CRM bulk writes must use the validated unit of work')
    firm = db.info.get('firm_id')
    if firm is None:
        raise RuntimeError('CRM session requires authenticated firm context')
    stmt = state.statement
    for model in m.CRM_MODELS:
        stmt = stmt.options(with_loader_criteria(model, model.firm_id == firm, include_aliases=True))
    # Membership display data must not survive a move to a different firm.
    stmt = stmt.options(with_loader_criteria(m.User, m.User.id.in_(select(PlatformUser.id).where(PlatformUser.firm_id == firm)), include_aliases=True))
    if not db.info.get('include_restricted'):
        hidden = db.info.get('hidden', {})
        for model, kind in KINDS.items():
            stmt = stmt.options(with_loader_criteria(model, model.id.not_in(tuple(hidden.get(kind, ()))), include_aliases=True))
        stmt = stmt.options(with_loader_criteria(m.EthicalWallMember, m.EthicalWallMember.wall_id.not_in(tuple(hidden.get('ethical_wall', ()))), include_aliases=True))
        # A historical audit image is restricted whenever its subject is restricted now.
        clause = m.AuditLog.id.not_in(tuple(hidden.get('audit_log', ())))
        for kind, ids in hidden.items():
            clause = and_(clause, or_(m.AuditLog.entity_type != kind, m.AuditLog.entity_id.not_in(tuple(str(i) for i in ids))))
        stmt = stmt.options(with_loader_criteria(m.AuditLog, clause, include_aliases=True))
        actor = db.info.get('actor')
        if actor and any(hidden.values()):
            # Historical file payloads cannot be reliably attributed to individual records.
            # Withhold them while the actor has restricted matters, including their own uploads.
            stmt = stmt.options(with_loader_criteria(m.ImportJob, m.ImportJob.id < 0, include_aliases=True))
            stmt = stmt.options(with_loader_criteria(m.AuditLog, m.AuditLog.entity_type.not_in(("import_job", "export")), include_aliases=True))
    state.statement = stmt


@event.listens_for(CrmSession, 'before_flush')
def validate_writes(db, _ctx, _instances):
    firm = db.info['firm_id']
    tables = {model.__tablename__: model for model in m.CRM_MODELS}
    settings = db.info.get('settings')
    changed = list(db.new) + list(db.deleted) + [obj for obj in db.dirty if db.is_modified(obj, include_collections=True)]
    if settings and any(isinstance(obj, (m.EthicalWall, m.EthicalWallMember, m.User)) for obj in changed):
        settings.access_revision += 1
    for obj in list(db.new) + list(db.dirty) + list(db.deleted):
        if type(obj) not in m.CRM_MODELS:
            continue
        if obj in db.new and obj.firm_id is None:
            obj.firm_id = firm
        if obj.firm_id != firm:
            raise NotFound('Record not found')
        state = inspect(obj)
        if state.persistent and state.attrs.firm_id.history.has_changes():
            raise Forbidden('Firm ownership cannot change')
        if isinstance(obj, m.Account) and obj in db.deleted and obj.shared_client_id:
            raise Conflict('Linked client accounts must be archived, not deleted')
        for column in obj.__table__.columns:
            if column.name == 'firm_id':
                continue
            value = getattr(obj, column.name)
            if value is None or (obj not in db.new and not state.attrs[state.mapper.get_property_by_column(column).key].history.has_changes()):
                continue
            for fk in column.foreign_keys:
                target = fk.column.table.name
                if target in tables:
                    if db.get(tables[target], value) is None:
                        raise NotFound('Referenced record not found')
                elif target == 'users':
                    user = db.get(PlatformUser, value)
                    if user is None or user.firm_id != firm:
                        raise NotFound('Firm member not found')
                elif target == 'clients':
                    client = db.get(Client, value)
                    if client is None or client.firm_id != firm:
                        raise NotFound('Client not found')
        if isinstance(obj, (m.Opportunity, m.Activity, m.ConflictCheck, m.Engagement)):
            account_id = getattr(obj, 'account_id', None)
            opportunity_id = getattr(obj, 'opportunity_id', None)
            contact_id = getattr(obj, 'primary_contact_id', None) or getattr(obj, 'contact_id', None)
            if account_id and opportunity_id:
                related = db.get(m.Opportunity, opportunity_id)
                if related and related.account_id != account_id:
                    raise Conflict('Opportunity and account must match')
            if account_id and contact_id:
                related = db.get(m.Contact, contact_id)
                if related and related.account_id not in (None, account_id):
                    raise Conflict('Contact and account must match')
        if isinstance(obj, m.Account) and obj.shared_client_id:
            from firmcrm.services.shared_clients import require_shared_write
            client = db.get(Client, obj.shared_client_id)
            for field in ('name', 'industry'):
                if state.attrs['_'+field].history.has_changes():
                    require_shared_write(db)
                    setattr(client, field, getattr(obj, '_'+field))
        if isinstance(obj, m.EthicalWall):
            model = m.Account if obj.entity_type == 'account' else m.Opportunity
            target = db.get(model, obj.entity_id)
            if target is None:
                raise NotFound('Record not found')
            if isinstance(target, m.Account) and target.shared_client_id and obj.is_active is not False:
                raise Conflict('Shared clients cannot have account-level ethical walls')


def get_db(request: Request, token: dict = Depends(verify_firebase_token)):
    from services.analytics.firm_scope import ensure_user_row, get_user_firm
    from firmcrm.provisioning import provision
    with db_config.get_session() as platform:
        ensure_user_row(platform, user_id=token['uid'], email=token.get('email', ''), display_name=token.get('name'), photo_url=token.get('picture'))
        user, firm = get_user_firm(platform, token['uid'])
        firm_id = firm.id
    with CrmSession(bind=db_config.engine, expire_on_commit=False, info={'firm_id': firm_id}) as db:
        # Serialize initialization and CRM mutations per firm. This also makes
        # wall creation and shared-client publication mutually exclusive under load.
        db.scalar(select(Firm).where(Firm.id == firm_id).with_for_update())
        actor, settings = provision(db, token['uid'])
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            db.commit()
        db.info.update(actor=actor, settings=settings, method=request.method)
        actor._settings = settings
        request.state.firmcrm_firm_id = str(firm_id)
        request.state.firmcrm_user_id = actor.id
        refresh_visibility(db)
        try:
            yield db
        finally:
            db.rollback()
