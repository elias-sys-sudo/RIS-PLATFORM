from django.urls import path
from .views import EligibilityCheckView

urlpatterns = [
    path('', EligibilityCheckView.as_view(), name='onboarding-eligibility-check'),
]
