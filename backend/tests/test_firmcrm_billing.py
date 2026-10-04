"""FirmCRM billing: profiles, invoice lifecycle, numbering, PDF output and tenant/wall isolation."""
from decimal import Decimal

import pymupdf
from sqlalchemy import select
from sqlalchemy.orm import Session

from firmcrm import models as m
from firmcrm.lifecycle import export_firm_crm
from test_firmcrm import account, call, crm, wall  # noqa: F401  (crm is a fixture)

PROFILE = {
    'label': 'Operating account', 'issuer_name': 'CPA Automation, Inc.', 'address_line1': '2258 21ST AVE',
    'city': 'SAN FRANCISCO', 'state': 'CA', 'postal_code': '94116', 'phone': '513-593-1883',
    'email': 'billing@cpaautomation.ai', 'account_name': 'CPA Automation, Inc.', 'routing_number': '21000021',
    'account_number': '2917930392',
}
LINES = [
    {'description': 'General Training Sessions and Prep Hours', 'unit_cost': '25000.00', 'quantity': '1'},
    {'description': 'AI Recon Skill (1 out of 3 totaled $54,000)', 'unit_cost': '18000.00', 'quantity': '1'},
]


def profile(crm, user='admin', **overrides):
    return call(crm, 'post', '/billing/profiles', user, 201, json={**PROFILE, **overrides})


def draft(crm, p, user='admin', **overrides):
    body = {'billing_profile_id': p['id'], 'billed_to_name': 'SB Investment Advisers (US) Inc.',
            'billed_to_address': '300 El Camino Real\nMenlo Park, California 94025', 'lines': LINES, **overrides}
    return call(crm, 'post', '/billing/invoices', user, 201, json=body)


def pdf_text(crm, invoice_id, user='admin'):
    response = crm[0].get(f'/api/firmcrm/billing/invoices/{invoice_id}/pdf', headers={'X-Test-User': user})
    assert response.status_code == 200, response.text
    assert response.headers['content-type'] == 'application/pdf'
    return pymupdf.open(stream=response.content, filetype='pdf')[0].get_text()


def test_profile_account_number_is_encrypted_and_masked(crm):
    p = profile(crm)
    assert p['account_number_last4'] == '0392' and p['is_default'] is True
    assert 'account_number' not in p and 'account_number_ciphertext' not in p
    with Session(crm[1]) as db:
        stored = db.scalar(select(m.BillingProfile.account_number_ciphertext))
        assert stored and b'2917930392' not in stored
    with Session(crm[1]) as db:
        snapshot = export_firm_crm(db, crm[2][0], 'admin')
        assert 'account_number_ciphertext' not in snapshot['billing_profiles'][0]
    second = profile(crm, label='Second', is_default=True)
    assert second['is_default'] is True
    assert [x['is_default'] for x in call(crm, 'get', '/billing/profiles')] == [True, False]


def test_profile_and_issue_permissions(crm):
    call(crm, 'post', '/billing/profiles', 'staff', 403, json=PROFILE)
    p = profile(crm, user='manager')
    call(crm, 'patch', f'/billing/profiles/{p["id"]}', 'staff', 403, json={'label': 'Nope'})
    invoice = draft(crm, p, user='staff')
    call(crm, 'patch', f'/billing/invoices/{invoice["id"]}', 'staff', 200, json={'notes': 'Thanks'})
    call(crm, 'post', f'/billing/invoices/{invoice["id"]}/issue', 'staff', 403)
    call(crm, 'post', f'/billing/invoices/{invoice["id"]}/issue', 'manager', 200)


def test_totals_are_server_computed_with_decimal_rounding(crm):
    p = profile(crm)
    invoice = draft(crm, p, lines=[*LINES, {'description': 'Hours', 'unit_cost': '150.25', 'quantity': '2.5', 'amount': '1'}])
    assert [Decimal(line['amount']) for line in invoice['lines']] == [Decimal('25000.00'), Decimal('18000.00'), Decimal('375.63')]
    assert Decimal(invoice['subtotal']) == Decimal(invoice['total']) == Decimal('43375.63')
    call(crm, 'post', '/billing/invoices', expected=422, json={'billing_profile_id': p['id'], 'billed_to_name': 'X',
                                                                'lines': [{'description': 'Bad', 'unit_cost': '-1', 'quantity': '1'}]})


def test_numbering_snapshot_and_lifecycle(crm):
    p = profile(crm)
    first, second, third = draft(crm, p), draft(crm, p), draft(crm, p)
    assert first['number'] is None and first['status'] == 'draft'
    issued = call(crm, 'post', f'/billing/invoices/{second["id"]}/issue')
    assert issued['number'] == '00001' and issued['status'] == 'issued'
    assert issued['due_date'] and issued['terms_text'].startswith('Please pay invoice by ')
    call(crm, 'post', f'/billing/invoices/{second["id"]}/void', json={'reason': 'Duplicate'})
    assert call(crm, 'post', f'/billing/invoices/{first["id"]}/issue')['number'] == '00002'
    call(crm, 'delete', f'/billing/invoices/{third["id"]}', expected=204)

    # Issued invoices are immutable and keep their issuer details after profile edits.
    call(crm, 'patch', f'/billing/invoices/{first["id"]}', expected=409, json={'notes': 'late edit'})
    call(crm, 'delete', f'/billing/invoices/{first["id"]}', expected=409)
    call(crm, 'patch', f'/billing/profiles/{p["id"]}', json={'issuer_name': 'Renamed LLC', 'account_number': '5555000011'})
    text = pdf_text(crm, first['id'])
    for expected in ['CPA Automation, Inc.', 'BILLED TO', 'SB Investment Advisers (US) Inc.', 'Menlo Park, California 94025',
                     'Invoice', '00002', 'General Training Sessions and Prep Hours', '$25,000.00', '$43,000.00',
                     'Wire Instruction', '21000021', '2917930392', 'Please pay invoice by']:
        assert expected in text, expected
    assert 'Renamed LLC' not in text and '5555000011' not in text

    paid = call(crm, 'post', f'/billing/invoices/{first["id"]}/mark-paid')
    assert paid['status'] == 'paid' and paid['paid_at']
    call(crm, 'post', f'/billing/invoices/{first["id"]}/void', expected=409, json={})
    copy = call(crm, 'post', f'/billing/invoices/{first["id"]}/duplicate', expected=201)
    assert copy['status'] == 'draft' and copy['number'] is None and len(copy['lines']) == 2
    assert 'DRAFT' in pdf_text(crm, copy['id'])


def test_account_prefill_and_engagement_must_match(crm):
    a = call(crm, 'post', '/accounts', expected=201, json={'name': 'SB Investment Advisers (US) Inc.', 'address': '300 El Camino Real',
                                                          'city': 'Menlo Park', 'state': 'California', 'postal_code': '94025'})
    call(crm, 'post', '/contacts', expected=201, json={'first_name': 'Ada', 'last_name': 'Payable', 'email': 'ap@sb.example', 'account_id': a['id']})
    prefill = call(crm, 'get', f'/billing/invoices/prefill?account_id={a["id"]}')
    assert prefill == {'account_id': a['id'], 'billed_to_name': 'SB Investment Advisers (US) Inc.',
                       'billed_to_address': '300 El Camino Real\nMenlo Park, California 94025', 'billed_to_email': 'ap@sb.example'}
    other = account(crm, 'Other')
    engagement = call(crm, 'post', '/engagements', expected=201, json={'name': 'Advisory', 'account_id': other['id']})
    p = profile(crm)
    call(crm, 'post', '/billing/invoices', expected=409, json={'billing_profile_id': p['id'], 'billed_to_name': 'SB',
                                                                'account_id': a['id'], 'engagement_id': engagement['id']})
    invoice = draft(crm, p, account_id=a['id'])
    assert invoice['account_name'] == 'SB Investment Advisers (US) Inc.'
    assert call(crm, 'get', f'/billing/invoices?account_id={a["id"]}')['total'] == 1


def test_tenant_isolation(crm):
    p = profile(crm)
    invoice = draft(crm, p)
    assert call(crm, 'get', '/billing/profiles', 'other') == []
    assert call(crm, 'get', '/billing/invoices', 'other')['total'] == 0
    call(crm, 'get', f'/billing/invoices/{invoice["id"]}', 'other', 404)
    call(crm, 'get', f'/billing/invoices/{invoice["id"]}/pdf', 'other', 404)
    call(crm, 'post', f'/billing/invoices/{invoice["id"]}/issue', 'other', 404)
    call(crm, 'post', '/billing/invoices', 'other', 404, json={'billing_profile_id': p['id'], 'billed_to_name': 'Forged'})
    other_profile = profile(crm, user='other')
    # Numbering is per firm.
    other_invoice = draft(crm, other_profile, user='other')
    assert call(crm, 'post', f'/billing/invoices/{other_invoice["id"]}/issue', 'other')['number'] == '00001'


def test_walled_account_invoices_are_hidden(crm):
    a = account(crm, 'Walled client')
    p = profile(crm)
    invoice = draft(crm, p, account_id=a['id'])
    wall(crm, a)  # only 'partner' is a member
    call(crm, 'patch', '/settings', json={'admin_bypasses_walls': False})
    call(crm, 'delete', '/walls/1/members/admin')
    assert call(crm, 'get', '/billing/invoices', 'manager')['total'] == 0
    call(crm, 'get', f'/billing/invoices/{invoice["id"]}', 'manager', 404)
    assert call(crm, 'get', f'/billing/invoices/{invoice["id"]}', 'partner')['id'] == invoice['id']

