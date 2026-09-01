from django.urls import path
from .views import (
    SupplierListCreateView,
    SupplierDetailView,
    SupplierKycUploadView,
    EligibilityCheckView,
)

app_name = 'suppliers'

urlpatterns = [
    path('', SupplierListCreateView.as_view(), name='supplier-list-create'),
    path('<uuid:id>', SupplierDetailView.as_view(), name='supplier-detail'),
    path('<uuid:id>/kyc', SupplierKycUploadView.as_view(), name='supplier-kyc-upload'),
    path('onboarding/eligibility', EligibilityCheckView.as_view(), name='supplier-eligibility'),
]
