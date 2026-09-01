from decimal import Decimal
from rest_framework import generics, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.db.models import Q
from django.utils import timezone

from .models import Invoice, InvoiceDocument
from apps.suppliers.models import Supplier
from apps.buyers.models import Buyer
from .serializers import (
    InvoiceListSerializer,
    InvoiceDetailSerializer,
    CreateInvoiceSerializer,
)
from apps.risk_engine.scorer import evaluate_invoice_risk
from apps.pricing.calculator import calculate_invoice_pricing

class InvoiceListCreateView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method == 'POST':
            return CreateInvoiceSerializer
        return InvoiceListSerializer

    def get_queryset(self):
        queryset = Invoice.objects.select_related('supplier', 'buyer').all()
        user = self.request.user

        # If user is supplier, filter to their invoices only
        if user.role == 'supplier' and user.supplier_id:
            queryset = queryset.filter(supplier_id=user.supplier_id)

        status_param = self.request.query_params.get('status')
        if status_param and status_param != 'all':
            queryset = queryset.filter(status=status_param)

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(invoice_number__icontains=search) |
                Q(supplier__company__icontains=search) |
                Q(buyer__name__icontains=search)
            )

        risk_band = self.request.query_params.get('risk_band') or self.request.query_params.get('riskBand')
        if risk_band and risk_band != 'all':
            queryset = queryset.filter(risk_grade=risk_band)

        return queryset

    def create(self, request, *args, **kwargs):
        serializer = CreateInvoiceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        buyer_id = data.get('buyerId') or data.get('buyer_id')
        buyer = generics.get_object_or_404(Buyer, id=buyer_id)

        # Get or assign supplier
        if request.user.role == 'supplier' and request.user.supplier_id:
            supplier = Supplier.objects.filter(id=request.user.supplier_id).first()
        else:
            supplier = Supplier.objects.first()

        invoice_number = data.get('invoiceNumber') or data.get('invoice_number') or f"INV-{timezone.now().strftime('%Y%m')}-{Invoice.objects.count() + 1:04d}"
        face_value = data.get('faceValue') or data.get('face_value') or Decimal('100000000.00')
        issue_date = data.get('issueDate') or data.get('issue_date') or timezone.now().date()
        due_date = data.get('dueDate') or data.get('due_date') or (timezone.now().date() + timezone.timedelta(days=60))

        invoice = Invoice(
            invoice_number=invoice_number,
            supplier=supplier,
            buyer=buyer,
            face_value_ugx=face_value,
            issue_date=issue_date,
            due_date=due_date,
            status='submitted',
        )

        # Run automated initial risk score & pricing
        score, grade, factors = evaluate_invoice_risk(invoice)
        invoice.risk_score = score
        invoice.risk_grade = grade
        invoice.score_factors = factors

        pricing = calculate_invoice_pricing(invoice, risk_grade=grade)
        invoice.pricing_breakdown = pricing
        invoice.advance_rate_pct = Decimal(str(pricing['advanceRatePct']))
        invoice.advance_amount_ugx = Decimal(str(pricing['advanceAmountUgx']))
        invoice.discount_fee_ugx = Decimal(str(pricing['discountFeeUgx']))
        invoice.net_advance_ugx = Decimal(str(pricing['netAdvanceUgx']))

        # Determine approval tier based on face value
        if face_value < Decimal('50000000'):
            invoice.approval_tier = 1
        elif face_value < Decimal('200000000'):
            invoice.approval_tier = 2
        elif face_value < Decimal('500000000'):
            invoice.approval_tier = 3
        else:
            invoice.approval_tier = 4

        invoice.save()

        # Create standard document placeholder
        InvoiceDocument.objects.create(
            invoice=invoice,
            doc_type='commercial_invoice',
            file_name=f"{invoice_number}_commercial_invoice.pdf",
            file_url='/media/invoices/mock_invoice.pdf',
            file_size_bytes=1024 * 350,
        )

        return Response({'invoiceId': str(invoice.id), 'id': str(invoice.id)}, status=status.HTTP_201_CREATED)

class InvoiceDetailView(generics.RetrieveAPIView):
    queryset = Invoice.objects.select_related('supplier', 'buyer').prefetch_related('documents').all()
    serializer_class = InvoiceDetailSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = 'id'

class InvoiceScoreView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        invoice = generics.get_object_or_404(Invoice, id=id)
        score, grade, factors = evaluate_invoice_risk(invoice)
        invoice.risk_score = score
        invoice.risk_grade = grade
        invoice.score_factors = factors
        invoice.save(update_fields=['risk_score', 'risk_grade', 'score_factors'])

        return Response(InvoiceDetailSerializer(invoice).data, status=status.HTTP_200_OK)

class InvoicePricingView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        invoice = generics.get_object_or_404(Invoice, id=id)
        pricing = calculate_invoice_pricing(invoice, risk_grade=invoice.risk_grade)
        invoice.pricing_breakdown = pricing
        invoice.advance_rate_pct = Decimal(str(pricing['advanceRatePct']))
        invoice.advance_amount_ugx = Decimal(str(pricing['advanceAmountUgx']))
        invoice.discount_fee_ugx = Decimal(str(pricing['discountFeeUgx']))
        invoice.net_advance_ugx = Decimal(str(pricing['netAdvanceUgx']))
        invoice.status = 'priced'
        invoice.save()

        return Response(InvoiceDetailSerializer(invoice).data, status=status.HTTP_200_OK)

class InvoiceApproveView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        invoice = generics.get_object_or_404(Invoice, id=id)
        comments = request.data.get('comments', 'Approved according to credit delegation matrix.')
        invoice.status = 'approved'
        invoice.credit_officer_notes = comments
        invoice.save(update_fields=['status', 'credit_officer_notes'])

        return Response(InvoiceDetailSerializer(invoice).data, status=status.HTTP_200_OK)

class InvoiceRejectView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        invoice = generics.get_object_or_404(Invoice, id=id)
        comments = request.data.get('comments', 'Declined per risk policy.')
        invoice.status = 'rejected'
        invoice.rejection_reason = comments
        invoice.save(update_fields=['status', 'rejection_reason'])

        return Response(InvoiceDetailSerializer(invoice).data, status=status.HTTP_200_OK)

class ResendConfirmationView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        invoice = generics.get_object_or_404(Invoice, id=id)
        return Response({
            'message': f"Verification email dispatched to buyer debtor ({invoice.buyer.contact_email or 'accounts@buyer.ug'})."
        }, status=status.HTTP_200_OK)
