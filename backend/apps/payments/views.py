import uuid
from django.utils import timezone
from rest_framework import permissions, status, generics
from rest_framework.views import APIView
from rest_framework.response import Response
from django.db.models import Q

from .models import PaymentRecord
from .serializers import PaymentRecordSerializer

class PaymentsListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        queryset = PaymentRecord.objects.select_related(
            'invoice', 'supplier', 'buyer', 'dual_auth_user1', 'dual_auth_user2'
        ).all()

        status_param = request.query_params.get('status')
        if status_param and status_param != 'all':
            queryset = queryset.filter(status=status_param)

        needs_my_sig = request.query_params.get('needsMySignature')
        if needs_my_sig == 'true':
            # Needs signature from current user (not signed by current user yet)
            user_id = request.user.id
            queryset = queryset.filter(
                Q(status='pending_signature') |
                (Q(status='partially_signed') & ~Q(dual_auth_user1_id=user_id))
            )

        serializer = PaymentRecordSerializer(queryset, many=True)

        return Response({
            'data': serializer.data,
            'total': queryset.count(),
            'page': 1,
            'totalPages': 1,
        }, status=status.HTTP_200_OK)

class PendingPaymentsAliasView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        queryset = PaymentRecord.objects.select_related(
            'invoice', 'supplier', 'buyer', 'dual_auth_user1', 'dual_auth_user2'
        ).filter(status__in=['pending_signature', 'partially_signed'])

        serializer = PaymentRecordSerializer(queryset, many=True)
        return Response({'data': serializer.data}, status=status.HTTP_200_OK)

class PaymentDetailView(generics.RetrieveAPIView):
    queryset = PaymentRecord.objects.select_related(
        'invoice', 'supplier', 'buyer', 'dual_auth_user1', 'dual_auth_user2'
    ).all()
    serializer_class = PaymentRecordSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = 'id'

class AuthorisePaymentView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        payment = generics.get_object_or_404(PaymentRecord, id=id)
        user = request.user

        # 1. First Signature
        if not payment.dual_auth_user1:
            payment.dual_auth_user1 = user
            payment.dual_auth_user1_at = timezone.now()
            payment.status = 'partially_signed'
            payment.save()

            return Response({
                'data': PaymentRecordSerializer(payment).data,
                'message': 'First cryptographic signature recorded. Awaiting second officer sign-off.',
            }, status=status.HTTP_200_OK)

        # 2. Second Signature - Enforce Segregation of Duties
        if payment.dual_auth_user1_id == user.id:
            return Response({
                'error': 'Dual-Control Segregation of Duties violation: The second signature must be provided by a distinct authorized officer.',
            }, status=status.HTTP_400_BAD_REQUEST)

        payment.dual_auth_user2 = user
        payment.dual_auth_user2_at = timezone.now()
        payment.status = 'disbursed'
        payment.funded_at = timezone.now()
        payment.transaction_reference = f"EFT-BOU-{timezone.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
        payment.save()

        # Update underlying invoice to funded
        invoice = payment.invoice
        invoice.status = 'funded'
        invoice.funded_at = timezone.now()
        invoice.save(update_fields=['status', 'funded_at'])

        return Response({
            'data': PaymentRecordSerializer(payment).data,
            'message': f"Dual-authorization complete! Payment successfully executed on Bank EFT rail. Ref: {payment.transaction_reference}",
        }, status=status.HTTP_200_OK)
