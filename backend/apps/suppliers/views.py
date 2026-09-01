import uuid
from decimal import Decimal
from rest_framework import generics, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.db.models import Q

from .models import Supplier, KycDocument
from .serializers import (
    SupplierSerializer,
    SupplierDetailSerializer,
    KycDocumentSerializer,
    EligibilityCheckSerializer,
)

class SupplierListCreateView(generics.ListCreateAPIView):
    serializer_class = SupplierSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Supplier.objects.all()
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(company__icontains=search) |
                Q(name__icontains=search) |
                Q(tin__icontains=search)
            )

        status_param = self.request.query_params.get('status')
        if status_param and status_param != 'all':
            queryset = queryset.filter(status=status_param)

        risk_band = self.request.query_params.get('riskBand') or self.request.query_params.get('risk_band')
        if risk_band and risk_band != 'all':
            queryset = queryset.filter(risk_band=risk_band)

        return queryset

class SupplierDetailView(generics.RetrieveUpdateAPIView):
    queryset = Supplier.objects.all()
    serializer_class = SupplierDetailSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = 'id'

class SupplierKycUploadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        supplier = generics.get_object_or_404(Supplier, id=id)
        doc_type = request.data.get('doc_type') or request.data.get('docType')
        file_name = request.data.get('file_name') or request.data.get('fileName') or 'document.pdf'
        file_url = request.data.get('file_url') or request.data.get('fileUrl') or '/media/uploads/mock_kyc.pdf'

        kyc_doc = KycDocument.objects.create(
            supplier=supplier,
            doc_type=doc_type or 'certificate_of_incorporation',
            file_name=file_name,
            file_url=file_url,
            is_verified=False,
        )

        return Response(KycDocumentSerializer(kyc_doc).data, status=status.HTTP_201_CREATED)

class EligibilityCheckView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = EligibilityCheckSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        registered = data.get('registeredCompany', data.get('registered_company', True))
        authorized = data.get('authorizedPerson', data.get('authorized_person', True))
        rev1 = data.get('revenueYear1', data.get('revenue_year1', Decimal('0')))
        
        # Eligibility criteria: registered SME with at least 50M UGX annual turnover
        if not registered or not authorized or rev1 < Decimal('50000000'):
            return Response({
                'passed': False,
                'message': 'Your business does not currently meet the minimum criteria (Registered Ugandan Company with >50M UGX annual turnover).',
            }, status=status.HTTP_200_OK)

        session_token = f"elig_{uuid.uuid4().hex[:24]}"

        return Response({
            'passed': True,
            'message': 'Congratulations! Your business qualifies for institutional reverse factoring.',
            'sessionToken': session_token,
        }, status=status.HTTP_200_OK)
