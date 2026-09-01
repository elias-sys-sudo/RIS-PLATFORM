from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    LoginView,
    Verify2FAView,
    StepUpVerifyView,
    MeView,
    Setup2FAView,
    Confirm2FAView,
    ForgotPasswordView,
    ResetPasswordView,
    ChangePasswordView,
)

app_name = 'authentication'

urlpatterns = [
    path('login', LoginView.as_view(), name='login'),
    path('2fa/verify', Verify2FAView.as_view(), name='verify-2fa'),
    path('2fa/setup', Setup2FAView.as_view(), name='setup-2fa'),
    path('2fa/confirm', Confirm2FAView.as_view(), name='confirm-2fa'),
    path('step-up', StepUpVerifyView.as_view(), name='step-up'),
    path('refresh', TokenRefreshView.as_view(), name='token-refresh'),
    path('me', MeView.as_view(), name='me'),
    path('forgot-password', ForgotPasswordView.as_view(), name='forgot-password'),
    path('reset-password', ResetPasswordView.as_view(), name='reset-password'),
    path('change-password', ChangePasswordView.as_view(), name='change-password'),
]
