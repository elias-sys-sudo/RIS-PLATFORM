from django.contrib import admin
from django.urls import path, include
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

urlpatterns = [
    path('admin/', admin.site.urls),
    
    # OpenAPI Schema & Interactive Docs
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),

    # Domain API Routing
    path('api/v1/auth/', include('apps.authentication.urls')),
    path('api/v1/onboarding/eligibility/check', include('apps.suppliers.onboarding_urls')),
    path('api/v1/suppliers/', include('apps.suppliers.urls')),
    path('api/v1/buyers/', include('apps.buyers.urls')),
    path('api/v1/invoices/', include('apps.invoices.urls')),
    path('api/v1/verification/', include('apps.verification.urls', namespace='verification')),
    path('api/v1/verify/', include(('apps.verification.urls', 'apps.verification'), namespace='verify_alias')),
    path('api/v1/pricing/', include('apps.pricing.urls')),
    path('api/v1/approvals/', include('apps.approvals.urls')),
    path('api/v1/payments/', include('apps.payments.urls')),
    path('api/v1/collections/', include('apps.collections.urls')),
    path('api/v1/settlements/', include('apps.settlements.urls')),
    path('api/v1/admin/risk-config/', include('apps.risk_engine.urls')),
]
