import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from apps.authentication.models import User
from apps.authentication.services import generate_tokens_for_user
from apps.suppliers.models import Supplier
from apps.buyers.models import Buyer
from apps.invoices.models import Invoice
from apps.risk_engine.models import RiskConfig

@pytest.fixture
def api_client():
    return APIClient()

@pytest.fixture
def officer_user(db):
    return User.objects.create_user(
        email='officer_test@ris.ug',
        password='password123',
        role='credit_officer',
    )

@pytest.fixture
def test_setup(db):
    supplier = Supplier.objects.create(
        company='Apex Manufacturing Ltd',
        name='Denis Mugisha',
        contact_email='denis@apex.ug',
        tin='1003322114',
        risk_band='low',
        total_invoices=12,
        total_outstanding_ugx=Decimal('200000000.00'),
    )
    buyer = Buyer.objects.create(
        name='Century Bottling Company',
        industry='Beverages',
        credit_limit=Decimal('2000000000.00'),
        available_limit=Decimal('1800000000.00'),
        payment_terms_days=60,
        credit_rating='AAA',
    )
    invoice = Invoice.objects.create(
        invoice_number='INV-TEST-0001',
        supplier=supplier,
        buyer=buyer,
        face_value_ugx=Decimal('150000000.00'),
        advance_rate_pct=Decimal('80.00'),
        advance_amount_ugx=Decimal('120000000.00'),
        discount_fee_ugx=Decimal('4200000.00'),
        net_advance_ugx=Decimal('115800000.00'),
        due_date='2026-11-30',
        status='submitted',
        risk_score=88,
        risk_grade='low',
    )
    RiskConfig.objects.create(
        key='weight_buyer_rating_test',
        label='Buyer Rating Weight Test',
        value=Decimal('35.00'),
        category='weight',
    )
    return supplier, buyer, invoice

@pytest.mark.django_db
def test_list_invoices(api_client, officer_user, test_setup):
    tokens = generate_tokens_for_user(officer_user)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    response = api_client.get('/api/v1/invoices/')
    assert response.status_code == 200
    data = response.json()
    assert 'data' in data
    assert len(data['data']) >= 1
    inv = data['data'][0]
    assert 'faceValue' in inv
    assert 'advanceAmount' in inv
    assert 'netAdvance' in inv
    assert 'riskScore' in inv

@pytest.mark.django_db
def test_create_and_auto_price_invoice(api_client, officer_user, test_setup):
    supplier, buyer, _ = test_setup
    tokens = generate_tokens_for_user(officer_user)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    response = api_client.post('/api/v1/invoices/submit', {
        'buyerId': str(buyer.id),
        'invoiceNumber': 'INV-AUTO-999',
        'faceValue': '200000000.00',
        'dueDate': '2026-12-15',
    }, format='json')

    assert response.status_code == 201
    created_id = response.json().get('invoiceId') or response.json().get('id')
    assert created_id is not None

    # Check that it was scored & priced automatically
    invoice_obj = Invoice.objects.get(id=created_id)
    assert invoice_obj.risk_score > 0
    assert invoice_obj.net_advance_ugx > Decimal('0')
    assert invoice_obj.discount_fee_ugx > Decimal('0')

@pytest.mark.django_db
def test_public_buyer_verification(api_client, test_setup):
    _, _, invoice = test_setup

    # 1. Fetch public verification
    fetch_resp = api_client.get(f'/api/v1/verify/{invoice.verification_token}')
    assert fetch_resp.status_code == 200
    fetch_data = fetch_resp.json()
    assert fetch_data['invoiceNumber'] == 'INV-TEST-0001'
    assert fetch_data['buyerName'] == 'Century Bottling Company'

    # 2. Confirm verification
    confirm_resp = api_client.post(f'/api/v1/verify/{invoice.verification_token}/confirm', {
        'invoiceIsValid': True,
        'amountIsCorrect': True,
        'dueDateIsCorrect': True,
        'agreesToPayRis': True,
    }, format='json')

    assert confirm_resp.status_code == 200
    invoice.refresh_from_db()
    assert invoice.status == 'verified'
    assert invoice.notice_of_assignment_signed is True

@pytest.mark.django_db
def test_risk_config_management(api_client, officer_user, test_setup):
    tokens = generate_tokens_for_user(officer_user)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    # List
    list_resp = api_client.get('/api/v1/admin/risk-config/')
    assert list_resp.status_code == 200
    configs = list_resp.json()
    assert len(configs) >= 1

    # Update parameter
    update_resp = api_client.put('/api/v1/admin/risk-config/weight_buyer_rating_test', {
        'value': 40.00,
    }, format='json')

    assert update_resp.status_code == 200
    cfg = RiskConfig.objects.get(key='weight_buyer_rating_test')
    assert float(cfg.value) == 40.00
