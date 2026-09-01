from django.urls import path
from .views import (
    PaymentsListView,
    PendingPaymentsAliasView,
    PaymentDetailView,
    AuthorisePaymentView,
)

app_name = 'payments'

urlpatterns = [
    path('', PaymentsListView.as_view(), name='payments-list'),
    path('pending', PendingPaymentsAliasView.as_view(), name='payments-pending'),
    path('<uuid:id>', PaymentDetailView.as_view(), name='payment-detail'),
    path('<uuid:id>/authorise', AuthorisePaymentView.as_view(), name='payment-authorise'),
    path('<uuid:id>/authorize', AuthorisePaymentView.as_view(), name='payment-authorize-alias'),
]
