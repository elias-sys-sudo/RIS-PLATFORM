from rest_framework import serializers
from .models import Settlement

class SettlementSerializer(serializers.ModelSerializer):
    invoiceId = serializers.UUIDField(source='invoice.id')
    invoiceNumber = serializers.CharField(source='invoice.invoice_number')
    supplierName = serializers.CharField(source='supplier.company')
    buyerName = serializers.CharField(source='buyer.name')
    faceValue = serializers.DecimalField(source='face_value_ugx', max_digits=18, decimal_places=2)
    collectedAmount = serializers.DecimalField(source='collected_amount_ugx', max_digits=18, decimal_places=2)
    advanceAmount = serializers.DecimalField(source='advance_amount_ugx', max_digits=18, decimal_places=2)
    discountEarned = serializers.DecimalField(source='discount_earned_ugx', max_digits=18, decimal_places=2)
    penaltyIncome = serializers.DecimalField(source='penalty_income_ugx', max_digits=18, decimal_places=2)
    facilityRepayment = serializers.DecimalField(source='facility_repayment_ugx', max_digits=18, decimal_places=2)
    netProfit = serializers.DecimalField(source='net_profit_ugx', max_digits=18, decimal_places=2)
    collectedAt = serializers.DateTimeField(source='collected_at')
    settledAt = serializers.DateTimeField(source='settled_at', allow_null=True)
    createdAt = serializers.DateTimeField(source='created_at')

    class Meta:
        model = Settlement
        fields = [
            'id',
            'invoiceId',
            'invoiceNumber',
            'supplierName',
            'buyerName',
            'faceValue',
            'collectedAmount',
            'advanceAmount',
            'discountEarned',
            'penaltyIncome',
            'facilityRepayment',
            'netProfit',
            'status',
            'collectedAt',
            'settledAt',
            'createdAt',
        ]
