from rest_framework import serializers
from .models import PaymentRecord

class PaymentRecordSerializer(serializers.ModelSerializer):
    invoiceId = serializers.UUIDField(source='invoice.id')
    invoiceNumber = serializers.CharField(source='invoice.invoice_number')
    supplierName = serializers.CharField(source='supplier.company')
    buyerName = serializers.CharField(source='buyer.name')
    amount = serializers.DecimalField(source='amount_ugx', max_digits=18, decimal_places=2)
    dualAuthUser1 = serializers.UUIDField(source='dual_auth_user1.id', allow_null=True)
    dualAuthUser1Name = serializers.CharField(source='dual_auth_user1.full_name', allow_null=True)
    dualAuthUser2 = serializers.UUIDField(source='dual_auth_user2.id', allow_null=True)
    dualAuthUser2Name = serializers.CharField(source='dual_auth_user2.full_name', allow_null=True)
    transactionReference = serializers.CharField(source='transaction_reference', allow_blank=True)
    fundedAt = serializers.DateTimeField(source='funded_at', allow_null=True)
    failureReason = serializers.CharField(source='failure_reason', allow_blank=True)
    createdAt = serializers.DateTimeField(source='created_at')
    slaDeadline = serializers.DateTimeField(source='sla_deadline')

    class Meta:
        model = PaymentRecord
        fields = [
            'id',
            'invoiceId',
            'invoiceNumber',
            'supplierName',
            'buyerName',
            'amount',
            'provider',
            'status',
            'dualAuthUser1',
            'dualAuthUser1Name',
            'dualAuthUser2',
            'dualAuthUser2Name',
            'transactionReference',
            'fundedAt',
            'failureReason',
            'createdAt',
            'slaDeadline',
        ]
