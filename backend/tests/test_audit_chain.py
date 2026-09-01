import pytest
from rest_framework.test import APIClient
from apps.authentication.models import User
from apps.authentication.services import generate_tokens_for_user
from apps.audit.models import AuditLog, GENESIS_HASH
from apps.audit.engine import record_audit_event, verify_audit_chain

@pytest.fixture
def api_client():
    return APIClient()

@pytest.fixture
def auditor_user(db):
    return User.objects.create_user(
        email='auditor_chain@ris.ug',
        password='password123',
        role='auditor',
    )

@pytest.mark.django_db
def test_cryptographic_audit_chain_integrity():
    # 1. Clear & Record sequence of audit blocks
    AuditLog.objects.all().delete()

    b1 = record_audit_event(
        action='INVOICE_SUBMITTED',
        resource_type='Invoice',
        resource_id='inv_101',
        payload={'amount': 150000000.0},
    )
    assert b1.previous_hash == GENESIS_HASH
    assert len(b1.hash) == 64

    b2 = record_audit_event(
        action='APPROVAL_GRANTED',
        resource_type='Invoice',
        resource_id='inv_101',
        payload={'tier': 2, 'officer': 'Credit Officer'},
    )
    assert b2.previous_hash == b1.hash

    b3 = record_audit_event(
        action='PAYMENT_EXECUTED',
        resource_type='PaymentRecord',
        resource_id='pay_101',
        payload={'status': 'disbursed'},
    )
    assert b3.previous_hash == b2.hash

    # 2. Verify complete chain
    is_valid, count, msg = verify_audit_chain()
    assert is_valid is True
    assert count == 3

@pytest.mark.django_db
def test_tamper_detection():
    AuditLog.objects.all().delete()

    b1 = record_audit_event(action='ACTION_1', resource_type='Test', resource_id='1', payload={'x': 10})
    b2 = record_audit_event(action='ACTION_2', resource_type='Test', resource_id='2', payload={'y': 20})

    # Maliciously modify the database payload of block 1 without updating hash
    b1.payload = {'x': 999999} # Tampered value
    b1.save(update_fields=['payload'])

    # Verification must fail and detect the exact tamper
    is_valid, bad_idx, err_msg = verify_audit_chain()
    assert is_valid is False
    assert bad_idx == 0
    assert 'Tamper detected' in err_msg

@pytest.mark.django_db
def test_audit_api_endpoints(api_client, auditor_user):
    tokens = generate_tokens_for_user(auditor_user)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    # 1. List logs
    logs_resp = api_client.get('/api/v1/audit/logs')
    assert logs_resp.status_code == 200
    data = logs_resp.json()
    assert 'data' in data

    # 2. Cryptographic verify endpoint
    verify_resp = api_client.get('/api/v1/audit/verify')
    assert verify_resp.status_code == 200
    verify_data = verify_resp.json()
    assert verify_data['isValid'] is True
    assert 'SHA-256' in verify_data['algorithm']
