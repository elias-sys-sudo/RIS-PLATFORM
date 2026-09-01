from decimal import Decimal
from django.utils import timezone
from rest_framework import permissions, status, generics
from rest_framework.views import APIView
from rest_framework.response import Response
from django.db.models import Q, Sum, Avg

from .models import CollectionCase, EscalationDocument
from .serializers import (
    CollectionSerializer,
    CollectionDetailSerializer,
    EscalationDocumentSerializer,
)
from apps.settlements.models import Settlement

class CollectionsListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        queryset = CollectionCase.objects.select_related(
            'invoice', 'supplier', 'buyer'
        ).all()

        status_param = request.query_params.get('status')
        if status_param and status_param != 'all':
            queryset = queryset.filter(status=status_param)

        escalation_param = request.query_params.get('escalationLevel') or request.query_params.get('escalation_level')
        if escalation_param and escalation_param != 'all':
            queryset = queryset.filter(escalation_level=escalation_param)

        search = request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(invoice__invoice_number__icontains=search) |
                Q(supplier__company__icontains=search) |
                Q(buyer__name__icontains=search)
            )

        # KPI Summaries
        total_outstanding = queryset.aggregate(s=Sum('outstanding_amount_ugx'))['s'] or Decimal('0.00')
        overdue_count = queryset.filter(days_overdue__gt=0).count()
        avg_days = queryset.aggregate(a=Avg('days_overdue'))['a'] or 0

        summary = {
            'totalOutstanding': float(total_outstanding),
            'overdueCount': overdue_count,
            'avgDaysOverdue': round(float(avg_days), 1),
            'recoveryRate': 94.2,
        }

        serializer = CollectionSerializer(queryset, many=True)

        return Response({
            'data': serializer.data,
            'total': queryset.count(),
            'page': 1,
            'totalPages': 1,
            'summary': summary,
        }, status=status.HTTP_200_OK)

class CollectionDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, id):
        case = generics.get_object_or_404(
            CollectionCase.objects.select_related('invoice', 'supplier', 'buyer').prefetch_related('documents'),
            id=id
        )
        return Response({'data': CollectionDetailSerializer(case).data}, status=status.HTTP_200_OK)

class RecordPaymentActionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        case = generics.get_object_or_404(CollectionCase, id=id)
        amount = Decimal(str(request.data.get('amount') or case.outstanding_amount_ugx))
        
        case.collected_amount_ugx += amount
        case.outstanding_amount_ugx = max(case.outstanding_amount_ugx - amount, Decimal('0.00'))
        
        if case.outstanding_amount_ugx == Decimal('0.00'):
            case.status = 'resolved'
            invoice = case.invoice
            invoice.status = 'collected'
            invoice.collected_at = timezone.now()
            invoice.save(update_fields=['status', 'collected_at'])

            # Automatically create Settlement Record ready for waterfall accounting
            discount_earned = invoice.discount_fee_ugx
            net_profit = discount_earned * Decimal('0.65') # Platform margin after bank cost of funds
            bank_cost = discount_earned - net_profit

            Settlement.objects.get_or_create(
                invoice=invoice,
                defaults={
                    'supplier': invoice.supplier,
                    'buyer': invoice.buyer,
                    'face_value_ugx': invoice.face_value_ugx,
                    'collected_amount_ugx': amount,
                    'advance_amount_ugx': invoice.net_advance_ugx,
                    'discount_earned_ugx': discount_earned,
                    'facility_repayment_ugx': invoice.net_advance_ugx,
                    'bank_cost_paid_ugx': bank_cost,
                    'net_profit_ugx': net_profit,
                    'status': 'pending',
                }
            )

        case.save()

        return Response({
            'message': f"Repayment of {amount:,.2f} UGX successfully logged.",
            'outstandingAmount': float(case.outstanding_amount_ugx),
            'status': case.status,
        }, status=status.HTTP_200_OK)

class EscalateActionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        case = generics.get_object_or_404(CollectionCase, id=id)
        target_level = request.data.get('targetLevel') or request.data.get('target_level') or 'formal_notice'
        reason = request.data.get('reason', 'Debtor failed to honour agreed settlement date.')

        case.escalation_level = target_level
        case.notes += f"\n[{timezone.now().strftime('%Y-%m-%d %H:%M')}] Escalated to {target_level}: {reason}"
        case.save()

        return Response({
            'message': f"Collection case escalated to {target_level}.",
            'escalationLevel': case.escalation_level,
        }, status=status.HTTP_200_OK)

class DeescalateActionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        case = generics.get_object_or_404(CollectionCase, id=id)
        target_level = request.data.get('targetLevel') or request.data.get('target_level') or 'none'

        case.escalation_level = target_level
        case.save()

        return Response({
            'message': f"Collection case de-escalated to {target_level}.",
            'escalationLevel': case.escalation_level,
        }, status=status.HTTP_200_OK)

class ResolveActionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        case = generics.get_object_or_404(CollectionCase, id=id)
        case.status = 'resolved'
        case.outstanding_amount_ugx = Decimal('0.00')
        case.save()

        return Response({
            'message': 'Collection case marked as fully resolved.',
            'status': case.status,
        }, status=status.HTTP_200_OK)

class CollectionDocumentsListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, id):
        docs = EscalationDocument.objects.filter(collection_case_id=id)
        return Response({'data': EscalationDocumentSerializer(docs, many=True).data}, status=status.HTTP_200_OK)

class GenerateDocumentDraftView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        case = generics.get_object_or_404(CollectionCase, id=id)
        doc_type = request.data.get('documentType') or request.data.get('document_type') or 'demand_letter'
        
        doc = EscalationDocument.objects.create(
            collection_case=case,
            document_type=doc_type,
            status='draft',
            deadline_days=7,
            additional_notes='Demanding immediate settlement within 7 business days per Notice of Assignment agreement.',
            generated_by=request.user.full_name,
        )

        return Response({
            'documentId': str(doc.id),
            'message': f"Formal draft for {doc.get_document_type_display()} created.",
        }, status=status.HTTP_201_CREATED)
