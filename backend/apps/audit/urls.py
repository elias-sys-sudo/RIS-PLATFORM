from django.urls import path
from .views import AuditLogsListView, AuditVerifyChainView

app_name = 'audit'

urlpatterns = [
    path('logs', AuditLogsListView.as_view(), name='audit-logs-list'),
    path('verify', AuditVerifyChainView.as_view(), name='audit-verify-chain'),
]
