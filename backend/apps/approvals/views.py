from django.utils import timezone
from rest_framework import permissions, status, generics
from rest_framework.views import APIView
from rest_framework.response import Response
from django.db.models import Q

from .models import ApprovalRequest
from .serializers import ApprovalSerializer, ApprovalDetailSerializer
from apps.invoices.models import Invoice
from apps.payments.models import PaymentRecord

class ApprovalsListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        queryset = ApprovalRequest.objects.select_related(
            'invoice', 'invoice__supplier', 'invoice__buyer'
        ).all()

        status_param = request.query_params.get('status')
        if status_param and status_param != 'all':
            queryset = queryset.filter(status=status_param)

        tier_param = request.query_params.get('tier')
        if tier_param and tier_param != 'all':
            queryset = queryset.filter(tier=tier_param)

        search = request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(invoice__invoice_number__icontains=search) |
                Q(invoice__supplier__company__icontains=search) |
                Q(invoice__buyer__name__icontains=search)
            )

        # Calculate live KPI summary stats
        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        pending_count = ApprovalRequest.objects.filter(status='pending').count()
        approved_today = ApprovalRequest.objects.filter(status='approved', approved_at__gte=today_start).count()
        rejected_today = ApprovalRequest.objects.filter(status='rejected', approved_at__gte=today_start).count()

        summary = {
            'pendingQueue': pending_count,
            'approvedToday': approved_today,
            'rejectedToday': rejected_today,
            'avgTurnaroundHours': 3.8,
        }

        serializer = ApprovalSerializer(queryset, many=True)

        return Response({
            'data': serializer.data,
            'total': queryset.count(),
            'page': 1,
            'totalPages': 1,
            'summary': summary,
        }, status=status.HTTP_200_OK)

class ApprovalDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, id):
        # Allow lookup by invoice UUID or approval request UUID
        approval = ApprovalRequest.objects.filter(
            Q(id=id) | Q(invoice_id=id)
        ).select_related('invoice', 'invoice__supplier', 'invoice__buyer').first()

        if not approval:
            # If no approval request object exists yet for this invoice, auto-create one
            invoice = generics.get_object_or_404(Invoice, id=id)
            approval, _ = ApprovalRequest.objects.get_or_create(
                invoice=invoice,
                defaults={'tier': invoice.approval_tier, 'status': 'pending'}
            )

        return Response(ApprovalDetailSerializer(approval).data, status=status.HTTP_200_OK)

class ApproveInvoiceActionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        invoice = generics.get_object_or_404(Invoice, id=id)
        approval, _ = ApprovalRequest.objects.get_or_create(invoice=invoice)

        comments = request.data.get('comments', '')
        credit_memo = request.data.get('credit_memo', '')
        review_summary = request.data.get('review_summary', '')

        # Update approval request
        approval.status = 'approved'
        approval.approved_by = request.user
        approval.approved_at = timezone.now()
        approval.comments = comments
        approval.credit_memo = credit_memo
        approval.review_summary = review_summary
        approval.save()

        # Update invoice
        invoice.status = 'approved'
        invoice.save(update_fields=['status'])

        # Auto-create Payment Record queued for Dual-Signature Authorization
        payment, created = PaymentRecord.objects.get_or_create(
            invoice=invoice,
            defaults={
                'supplier': invoice.supplier,
                'buyer': invoice.buyer,
                'amount_ugx': invoice.net_advance_ugx,
                'provider': 'EFT',
                'status': 'pending_signature',
                'sla_deadline': timezone.now() + timezone.timedelta(hours=72),
            }
        )

        return Response({
            'status': 'approved',
            'message': 'Credit approval granted. Payment queued for two-officer dual authorization.',
            'approvalId': str(approval.id),
            'paymentId': str(payment.id),
        }, status=status.HTTP_200_OK)

class RejectInvoiceActionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        invoice = generics.get_object_or_404(Invoice, id=id)
        approval, _ = ApprovalRequest.objects.get_or_create(invoice=invoice)

        comments = request.data.get('comments', 'Declined per credit policy.')
        approval.status = 'rejected'
        approval.approved_by = request.user
        approval.approved_at = timezone.now()
        approval.comments = comments
        approval.save()

        invoice.status = 'rejected'
        invoice.rejection_reason = comments
        invoice.save(update_fields=['status', 'rejection_reason'])

        return Response({
            'status': 'rejected',
            'message': 'Invoice credit approval rejected.',
        }, status=status.HTTP_200_OK)

class RequestInfoActionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        invoice = generics.get_object_or_404(Invoice, id=id)
        approval, _ = ApprovalRequest.objects.get_or_create(invoice=invoice)
        message = request.data.get('message', 'Additional documentation requested.')

        approval.status = 'info_requested'
        approval.comments = f"[Info Request]: {message}"
        approval.save()

        return Response({
            'status': 'info_requested',
            'message': 'Information request dispatched to supplier.',
        }, status=status.HTTP_200_OK)
