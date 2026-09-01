from django.urls import path
from .views import (
    InvoiceListCreateView,
    InvoiceDetailView,
    InvoiceScoreView,
    InvoicePricingView,
    InvoiceApproveView,
    InvoiceRejectView,
    ResendConfirmationView,
)

app_name = 'invoices'

urlpatterns = [
    path('', InvoiceListCreateView.as_view(), name='invoice-list-create'),
    path('submit', InvoiceListCreateView.as_view(), name='invoice-submit'),
    path('<uuid:id>', InvoiceDetailView.as_view(), name='invoice-detail'),
    path('<uuid:id>/score', InvoiceScoreView.as_view(), name='invoice-score'),
    path('<uuid:id>/pricing/generate', InvoicePricingView.as_view(), name='invoice-pricing-generate'),
    path('<uuid:id>/approve', InvoiceApproveView.as_view(), name='invoice-approve'),
    path('<uuid:id>/reject', InvoiceRejectView.as_view(), name='invoice-reject'),
    path('<uuid:id>/resend-confirmation', ResendConfirmationView.as_view(), name='invoice-resend-confirmation'),
]
