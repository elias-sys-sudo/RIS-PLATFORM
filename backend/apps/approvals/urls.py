from django.urls import path
from .views import (
    ApprovalsListView,
    ApprovalDetailView,
    ApproveInvoiceActionView,
    RejectInvoiceActionView,
    RequestInfoActionView,
)

app_name = 'approvals'

urlpatterns = [
    path('', ApprovalsListView.as_view(), name='approvals-list'),
    path('<uuid:id>', ApprovalDetailView.as_view(), name='approval-detail'),
    path('<uuid:id>/approve', ApproveInvoiceActionView.as_view(), name='approval-approve'),
    path('<uuid:id>/reject', RejectInvoiceActionView.as_view(), name='approval-reject'),
    path('<uuid:id>/request-info', RequestInfoActionView.as_view(), name='approval-request-info'),
]
