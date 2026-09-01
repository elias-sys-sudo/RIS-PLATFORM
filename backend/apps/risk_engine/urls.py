from django.urls import path
from .views import RiskConfigListView, RiskConfigDetailView

app_name = 'risk_engine'

urlpatterns = [
    path('', RiskConfigListView.as_view(), name='risk-config-list'),
    path('<str:key>', RiskConfigDetailView.as_view(), name='risk-config-detail'),
]
