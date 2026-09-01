from django.urls import path
from .views import (
    FetchVerificationView,
    ConfirmVerificationView,
    DisputeVerificationView,
)

app_name = 'verification'

urlpatterns = [
    path('<str:token>', FetchVerificationView.as_view(), name='fetch-verification'),
    path('<str:token>/confirm', ConfirmVerificationView.as_view(), name='confirm-verification'),
    path('<str:token>/dispute', DisputeVerificationView.as_view(), name='dispute-verification'),
]
