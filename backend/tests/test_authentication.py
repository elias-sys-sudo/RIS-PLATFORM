import pytest
from rest_framework.test import APIClient
from apps.authentication.models import User
from apps.authentication.services import generate_tokens_for_user

@pytest.fixture
def api_client():
    return APIClient()

@pytest.fixture
def supplier_user(db):
    user = User.objects.create_user(
        email='supplier_test@ris.ug',
        password='password123',
        first_name='Test',
        last_name='Supplier',
        role='supplier',
        is_2fa_enabled=False,
    )
    return user

@pytest.fixture
def two_factor_user(db):
    user = User.objects.create_user(
        email='finance_test@ris.ug',
        password='password123',
        first_name='Finance',
        last_name='Manager',
        role='finance_manager',
        is_2fa_enabled=True,
        totp_secret='JBSWY3DPEHPK3PXP',
    )
    return user

@pytest.mark.django_db
def test_login_straight_through(api_client, supplier_user):
    response = api_client.post('/api/v1/auth/login', {
        'email': 'supplier_test@ris.ug',
        'password': 'password123',
    }, format='json')

    assert response.status_code == 200
    data = response.json()
    assert 'accessToken' in data
    assert 'refreshToken' in data
    assert data['user']['email'] == 'supplier_test@ris.ug'
    assert data['user']['role'] == 'supplier'

@pytest.mark.django_db
def test_login_with_2fa_challenge(api_client, two_factor_user):
    response = api_client.post('/api/v1/auth/login', {
        'email': 'finance_test@ris.ug',
        'password': 'password123',
    }, format='json')

    assert response.status_code == 200
    data = response.json()
    assert data.get('requires2fa') is True
    assert 'partialAuthToken' in data

    # Verify 2FA with demo code
    verify_resp = api_client.post('/api/v1/auth/2fa/verify', {
        'code': '123456',
        'partialAuthToken': data['partialAuthToken'],
    }, format='json')

    assert verify_resp.status_code == 200
    verify_data = verify_resp.json()
    assert 'accessToken' in verify_data
    assert verify_data['user']['role'] == 'finance_manager'

@pytest.mark.django_db
def test_get_me_profile(api_client, supplier_user):
    tokens = generate_tokens_for_user(supplier_user)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    response = api_client.get('/api/v1/auth/me')
    assert response.status_code == 200
    assert response.json()['user']['email'] == supplier_user.email
