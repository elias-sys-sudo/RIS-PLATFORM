import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from django.utils import timezone
from apps.authentication.models import User
from apps.authentication.services import generate_tokens_for_user
from apps.suppliers.models import Supplier
from apps.buyers.models import Buyer
from apps.invoices.models import Invoice
from apps.approvals.models import ApprovalRequest
from apps.payments.models import PaymentRecord

@pytest.fixture
def api_client():
    return APIClient()

@pytest.fixture
def users(db):
    officer = User.objects.create_user(email='officer_ap@ris.ug', password='password123', role='credit_officer', first_name='Credit', last_name='Officer')
    finance1 = User.objects.create_user(email='finance1_ap@ris.ug', password='password123', role='finance_manager', first_name='Finance', last_name='Manager')
    management = User.objects.create_user(email='mgmt_ap@ris.ug', password='password123', role='management', first_name='General', last_name='Manager')
    return officer, finance1, management

@pytest.fixture
def workflow_setup(db):
    supplier = Supplier.objects.create(
        company='Tororo Cement Ltd',
        name='Brij Gagrani',
        contact_email='brij@tororocement.com',
        tin='1004455667',
        risk_band='low',
    )
    buyer = Buyer.objects.create(
        name='Roko Construction Limited',
        industry='Construction',
        credit_limit=Decimal('1500000000.00'),
        payment_terms_days=60,
    )
    invoice = Invoice.objects.create(
        invoice_number='INV-WORKFLOW-01',
        supplier=supplier,
        buyer=buyer,
        face_value_ugx=Decimal('300000000.00'),
        advance_rate_pct=Decimal('80.00'),
        advance_amount_ugx=Decimal('240000000.00'),
        discount_fee_ugx=Decimal('7500000.00'),
        net_advance_ugx=Decimal('232500000.00'),
        due_date='2026-12-31',
        status='verified',
        approval_tier=3,
    )
    return supplier, buyer, invoice

@pytest.mark.django_db
def test_approvals_list_and_kpis(api_client, users, workflow_setup):
    officer, _, _ = users
    _, _, invoice = workflow_setup
    ApprovalRequest.objects.create(invoice=invoice, tier=3, status='pending')

    tokens = generate_tokens_for_user(officer)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    response = api_client.get('/api/v1/approvals/')
    assert response.status_code == 200
    data = response.json()
    assert 'data' in data
    assert 'summary' in data
    assert data['summary']['pendingQueue'] >= 1

@pytest.mark.django_db
def test_approve_invoice_and_queue_payment(api_client, users, workflow_setup):
    officer, _, _ = users
    _, _, invoice = workflow_setup
    tokens = generate_tokens_for_user(officer)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    # Approve
    response = api_client.post(f'/api/v1/approvals/{invoice.id}/approve', {
        'comments': 'Comprehensive credit check passed. Approved for funding.',
    }, format='json')

    assert response.status_code == 200
    invoice.refresh_from_db()
    assert invoice.status == 'approved'

    # Check payment queued
    payment = PaymentRecord.objects.filter(invoice=invoice).first()
    assert payment is not None
    assert payment.status == 'pending_signature'
    assert payment.amount_ugx == Decimal('232500000.00')

@pytest.mark.django_db
def test_dual_signature_payment_execution(api_client, users, workflow_setup):
    _, finance1, management = users
    _, _, invoice = workflow_setup
    invoice.status = 'approved'
    invoice.save()

    payment = PaymentRecord.objects.create(
        invoice=invoice,
        supplier=invoice.supplier,
        buyer=invoice.buyer,
        amount_ugx=invoice.net_advance_ugx,
        provider='EFT',
        status='pending_signature',
        sla_deadline=timezone.now() + timezone.timedelta(hours=72),
    )

    # 1. First Signature by Finance Manager
    tokens_fin = generate_tokens_for_user(finance1)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens_fin['access']}")

    resp1 = api_client.post(f'/api/v1/payments/{payment.id}/authorise')
    assert resp1.status_code == 200
    payment.refresh_from_db()
    assert payment.status == 'partially_signed'
    assert payment.dual_auth_user1_id == finance1.id

    # 2. Attempt Second Signature by the SAME user -> Must fail with 400
    resp_same = api_client.post(f'/api/v1/payments/{payment.id}/authorise')
    assert resp_same.status_code == 400
    assert 'Segregation of Duties' in resp_same.json()['error']

    # 3. Second Signature by distinct Management user -> Must succeed and disburse
    tokens_mgmt = generate_tokens_for_user(management)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens_mgmt['access']}")

    resp2 = api_client.post(f'/api/v1/payments/{payment.id}/authorise')
    assert resp2.status_code == 200
    payment.refresh_from_db()
    invoice.refresh_from_db()

    assert payment.status == 'disbursed'
    assert payment.dual_auth_user2_id == management.id
    assert payment.funded_at is not None
    assert invoice.status == 'funded'
