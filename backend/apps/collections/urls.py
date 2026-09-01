from django.urls import path
from .views import (
    CollectionsListView,
    CollectionDetailView,
    RecordPaymentActionView,
    EscalateActionView,
    DeescalateActionView,
    ResolveActionView,
    CollectionDocumentsListView,
    GenerateDocumentDraftView,
)

app_name = 'collections'

urlpatterns = [
    path('', CollectionsListView.as_view(), name='collections-list'),
    path('<uuid:id>', CollectionDetailView.as_view(), name='collection-detail'),
    path('<uuid:id>/payments', RecordPaymentActionView.as_view(), name='collection-record-payment'),
    path('<uuid:id>/escalate', EscalateActionView.as_view(), name='collection-escalate'),
    path('<uuid:id>/de-escalate', DeescalateActionView.as_view(), name='collection-deescalate'),
    path('<uuid:id>/resolve', ResolveActionView.as_view(), name='collection-resolve'),
    path('<uuid:id>/documents', CollectionDocumentsListView.as_view(), name='collection-documents'),
    path('<uuid:id>/documents/draft', GenerateDocumentDraftView.as_view(), name='collection-documents-draft'),
]
