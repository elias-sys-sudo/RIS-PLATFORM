from django.urls import path
from .views import BuyerListCreateView, BuyerDetailView

app_name = 'buyers'

urlpatterns = [
    path('', BuyerListCreateView.as_view(), name='buyer-list-create'),
    path('<uuid:id>', BuyerDetailView.as_view(), name='buyer-detail'),
]
