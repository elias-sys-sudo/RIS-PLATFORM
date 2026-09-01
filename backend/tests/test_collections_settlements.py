import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from django.utils import timezone
from apps.authentication.models import User
from apps.authentication.services import generate_tokens_for_user
from apps.suppliers.models import Supplier
from apps.buyers.models import Buyer
from apps.invoices.models import Invoice
from apps.collections.models import CollectionCase, EscalationDocument
from apps.settlements.models import Settlement

@pytest.fixture
def api_client():
    return APIClient()

@pytest.fixture
def finance_user(db):
    return User.objects.create_user(
        email='finance_test_cs@ris.ug',
        password='password123',
        role='finance_manager',
    )

@pytest.fixture
def test_data(db):
    supplier = Supplier.objects.create(
        company='Hima Cement Ltd',
        name='Jean-Michel',
        contact_email='jm@hima.ug',
        tin='1005566778',
        risk_band='low',
    )
    buyer = Buyer.objects.create(
        name='SBC Uganda (Kabaale Airport)',
        industry='Infrastructure',
        credit_limit=Decimal('5000000000.00'),
        payment_terms_days=60,
    )
    invoice = Invoice.objects.create(
        invoice_number='INV-CS-0099',
        supplier=supplier,
        buyer=buyer,
        face_value_ugx=Decimal('500000000.00'),
        advance_rate_pct=Decimal('80.00'),
        advance_amount_ugx=Decimal('400000000.00'),
        discount_fee_ugx=Decimal('12500000.00'),
        net_advance_ugx=Decimal('387500000.00'),
        due_date='2026-08-15',
        status='overdue',
    )
    case = CollectionCase.objects.create(
        invoice=invoice,
        supplier=supplier,
        buyer=buyer,
        outstanding_amount_ugx=Decimal('500000000.00'),
        collected_amount_ugx=Decimal('0.00'),
        days_overdue=15,
        escalation_level='reminder_letter',
        status='active',
    )
    return supplier, buyer, invoice, case

@pytest.mark.django_db
def test_collections_list_and_kpi_summary(api_client, finance_user, test_data):
    tokens = generate_tokens_for_user(finance_user)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    response = api_client.get('/api/v1/collections/')
    assert response.status_code == 200
    data = response.json()
    assert 'data' in data
    assert 'summary' in data
    assert data['summary']['totalOutstanding'] >= 500000000.0
    assert data['summary']['overdueCount'] >= 1

@pytest.mark.django_db
def test_collections_escalate_and_draft_demand_letter(api_client, finance_user, test_data):
    _, _, _, case = test_data
    tokens = generate_tokens_for_user(finance_user)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    # 1. Escalate
    esc_resp = api_client.post(f'/api/v1/collections/{case.id}/escalate', {
        'targetLevel': 'formal_notice',
        'reason': 'Debtor failed to honour initial reminder.',
    }, format='json')
    assert esc_resp.status_code == 200
    case.refresh_from_db()
    assert case.escalation_level == 'formal_notice'

    # 2. Draft Demand Letter
    doc_resp = api_client.post(f'/api/v1/collections/{case.id}/documents/draft', {
        'documentType': 'demand_letter',
    }, format='json')
    assert doc_resp.status_code == 201
    assert 'documentId' in doc_resp.json()

@pytest.mark.django_db
def test_record_collection_payment_and_auto_settle(api_client, finance_user, test_data):
    _, _, invoice, case = test_data
    tokens = generate_tokens_for_user(finance_user)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    # Full payment from debtor
    pay_resp = api_client.post(f'/api/v1/collections/{case.id}/payments', {
        'amount': '500000000.00',
    }, format='json')

    assert pay_resp.status_code == 200
    case.refresh_from_db()
    invoice.refresh_from_db()
    assert case.status == 'resolved'
    assert invoice.status == 'collected'

    # Check auto-created Settlement ledger record
    settlement = Settlement.objects.filter(invoice=invoice).first()
    assert settlement is not None
    assert settlement.status == 'pending'
    assert settlement.collected_amount_ugx == Decimal('500000000.00')

@pytest.mark.django_db
def test_settlement_waterfall_lifecycle(api_client, finance_user, test_data):
    _, _, invoice, _ = test_data
    settlement = Settlement.objects.create(
        invoice=invoice,
        supplier=invoice.supplier,
        buyer=invoice.buyer,
        face_value_ugx=Decimal('500000000.00'),
        collected_amount_ugx=Decimal('500000000.00'),
        advance_amount_ugx=Decimal('387500000.00'),
        discount_earned_ugx=Decimal('12500000.00'),
        bank_cost_paid_ugx=Decimal('4375000.00'),
        status='pending',
    )

    tokens = generate_tokens_for_user(finance_user)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    # 1. Repay Facility
    repay_resp = api_client.post(f'/api/v1/settlements/{settlement.id}/repay-facility', {
        'facilityRepaymentAmount': '387500000.00',
    }, format='json')
    assert repay_resp.status_code == 200
    settlement.refresh_from_db()
    assert settlement.status == 'facility_repaid'

    # 2. Book Profit
    profit_resp = api_client.post(f'/api/v1/settlements/{settlement.id}/book-profit', {
        'discountEarned': '12500000.00',
        'bankCostPaid': '4375000.00',
    }, format='json')
    assert profit_resp.status_code == 200
    settlement.refresh_from_db()
    assert settlement.status == 'profit_booked'
    assert settlement.net_profit_ugx == Decimal('8125000.00')
