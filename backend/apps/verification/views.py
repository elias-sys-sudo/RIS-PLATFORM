from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import permissions, status, generics
from django.utils import timezone
from apps.invoices.models import Invoice

class FetchVerificationView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, token):
        invoice = generics.get_object_or_404(Invoice, verification_token=token)
        return Response({
            'invoiceNumber': invoice.invoice_number,
            'supplierName': invoice.supplier.company,
            'buyerName': invoice.buyer.name,
            'faceValue': float(invoice.face_value_ugx),
            'dueDate': invoice.due_date.isoformat(),
            'description': f"Commercial supply invoice {invoice.invoice_number} submitted by {invoice.supplier.company}",
            'status': invoice.status,
            'noticeOfAssignmentSigned': invoice.notice_of_assignment_signed,
        }, status=status.HTTP_200_OK)

class ConfirmVerificationView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request, token):
        invoice = generics.get_object_or_404(Invoice, verification_token=token)
        
        invoice_is_valid = request.data.get('invoiceIsValid', True)
        amount_is_correct = request.data.get('amountIsCorrect', True)
        agrees_to_pay_ris = request.data.get('agreesToPayRis', True)

        if not (invoice_is_valid and amount_is_correct and agrees_to_pay_ris):
            return Response({
                'error': 'All 4 verification and Notice of Assignment declarations must be confirmed.'
            }, status=status.HTTP_400_BAD_REQUEST)

        invoice.status = 'verified'
        invoice.verified_at = timezone.now()
        invoice.notice_of_assignment_signed = True
        invoice.save(update_fields=['status', 'verified_at', 'notice_of_assignment_signed'])

        return Response({
            'message': 'Invoice successfully verified and Notice of Assignment acknowledged.'
        }, status=status.HTTP_200_OK)

class DisputeVerificationView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request, token):
        invoice = generics.get_object_or_404(Invoice, verification_token=token)
        reason = request.data.get('reason', 'Buyer reported dispute on goods / amount.')
        dispute_type = request.data.get('disputeType', 'incorrect_amount')

        invoice.status = 'rejected'
        invoice.rejection_reason = f"Buyer Dispute [{dispute_type}]: {reason}"
        invoice.save(update_fields=['status', 'rejection_reason'])

        return Response({
            'message': 'Dispute recorded. The commercial invoice has been flagged for credit officer review.'
        }, status=status.HTTP_200_OK)
