import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from apps.authentication.models import User
from apps.authentication.services import generate_tokens_for_user
from apps.suppliers.models import Supplier
from apps.buyers.models import Buyer

@pytest.fixture
def api_client():
    return APIClient()

@pytest.fixture
def auth_user(db):
    user = User.objects.create_user(
        email='credit_officer_test@ris.ug',
        password='password123',
        role='credit_officer',
    )
    return user

@pytest.fixture
def sample_supplier(db):
    return Supplier.objects.create(
        company='Kampala Pharma Ltd',
        name='Dr. Grace Kigozi',
        contact_email='grace@kpharma.ug',
        contact_phone='+256 772 999888',
        tin='1009988776',
        risk_band='low',
        total_invoices=5,
        total_outstanding_ugx=Decimal('120000000.00'),
    )

@pytest.fixture
def sample_buyer(db):
    return Buyer.objects.create(
        name='Uganda Breweries Limited',
        industry='Beverages',
        credit_limit=Decimal('1500000000.00'),
        available_limit=Decimal('1200000000.00'),
        payment_terms_days=60,
        credit_rating='AAA',
    )

@pytest.mark.django_db
def test_list_suppliers(api_client, auth_user, sample_supplier):
    tokens = generate_tokens_for_user(auth_user)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    response = api_client.get('/api/v1/suppliers/')
    assert response.status_code == 200
    data = response.json()
    assert 'data' in data
    assert len(data['data']) >= 1
    supplier_data = data['data'][0]
    assert 'company' in supplier_data
    assert 'totalOutstandingUgx' in supplier_data

@pytest.mark.django_db
def test_get_supplier_detail(api_client, auth_user, sample_supplier):
    tokens = generate_tokens_for_user(auth_user)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    response = api_client.get(f'/api/v1/suppliers/{sample_supplier.id}')
    assert response.status_code == 200
    data = response.json()
    assert data['company'] == 'Kampala Pharma Ltd'
    assert 'metrics' in data
    assert data['metrics']['collectionRate'] > 0

@pytest.mark.django_db
def test_eligibility_check_pass(api_client):
    response = api_client.post('/api/v1/onboarding/eligibility/check', {
        'registeredCompany': True,
        'authorizedPerson': True,
        'yearsInBusiness': '2-5',
        'revenueYear1': 120000000,
        'revenueYear2': 180000000,
    }, format='json')

    assert response.status_code == 200
    data = response.json()
    assert data['passed'] is True
    assert 'sessionToken' in data

@pytest.mark.django_db
def test_eligibility_check_fail_low_revenue(api_client):
    response = api_client.post('/api/v1/onboarding/eligibility/check', {
        'registeredCompany': True,
        'authorizedPerson': True,
        'yearsInBusiness': '0-1',
        'revenueYear1': 10000000, # Less than 50M
        'revenueYear2': 12000000,
    }, format='json')

    assert response.status_code == 200
    data = response.json()
    assert data['passed'] is False

@pytest.mark.django_db
def test_list_and_create_buyer(api_client, auth_user, sample_buyer):
    tokens = generate_tokens_for_user(auth_user)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    # List
    response = api_client.get('/api/v1/buyers/')
    assert response.status_code == 200
    data = response.json()
    assert len(data['data']) >= 1

    # Create new buyer
    create_resp = api_client.post('/api/v1/buyers/', {
        'name': 'Cipla Quality Chemical Industries',
        'industry': 'Pharmaceuticals',
        'creditLimit': '2000000000.00',
        'paymentTermsDays': 45,
        'credit_rating': 'AA',
    }, format='json')

    assert create_resp.status_code == 201
    created_data = create_resp.json()
    assert created_data['name'] == 'Cipla Quality Chemical Industries'
    assert float(created_data['creditLimit']) == 2000000000.00
