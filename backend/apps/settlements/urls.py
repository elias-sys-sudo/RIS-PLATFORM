from django.urls import path
from .views import (
    SettlementsListView,
    SettlementDetailView,
    RepayFacilityActionView,
    BookProfitActionView,
    CloseSettlementActionView,
)

app_name = 'settlements'

urlpatterns = [
    path('', SettlementsListView.as_view(), name='settlements-list'),
    path('<uuid:id>', SettlementDetailView.as_view(), name='settlement-detail'),
    path('<uuid:id>/repay-facility', RepayFacilityActionView.as_view(), name='settlement-repay-facility'),
    path('<uuid:id>/book-profit', BookProfitActionView.as_view(), name='settlement-book-profit'),
    path('<uuid:id>/close', CloseSettlementActionView.as_view(), name='settlement-close'),
]
