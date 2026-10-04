from firmcrm.core.routing import FirmCrmRoute
from fastapi import APIRouter

from firmcrm.api import (
    accounts,
    activities,
    admin,
    billing,
    campaigns,
    conflicts,
    contacts,
    data,
    engagements,
    leads,
    opportunities,
    reference,
    reports,
    users,
    walls,
)

api_router = APIRouter(route_class=FirmCrmRoute, )
for r in (users, reference, accounts, contacts, leads, opportunities, activities, conflicts, engagements, campaigns,
          reports, admin, data, walls, billing):
    api_router.include_router(r.router)

from firmcrm.api import context, shared_clients
api_router.include_router(context.router)
api_router.include_router(shared_clients.router)
