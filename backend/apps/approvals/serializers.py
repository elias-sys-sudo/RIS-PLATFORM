from rest_framework import serializers
from .models import ApprovalRequest

class ApprovalSerializer(serializers.ModelSerializer):
    invoiceId = serializers.UUIDField(source='invoice.id')
    invoiceNumber = serializers.CharField(source='invoice.invoice_number')
    supplierName = serializers.CharField(source='invoice.supplier.company')
    buyerName = serializers.CharField(source='invoice.buyer.name')
    faceValue = serializers.DecimalField(source='invoice.face_value_ugx', max_digits=18, decimal_places=2)
    advanceAmount = serializers.DecimalField(source='invoice.advance_amount_ugx', max_digits=18, decimal_places=2)
    netAdvance = serializers.DecimalField(source='invoice.net_advance_ugx', max_digits=18, decimal_places=2)
    discountFee = serializers.DecimalField(source='invoice.discount_fee_ugx', max_digits=18, decimal_places=2)
    riskScore = serializers.IntegerField(source='invoice.risk_score')
    riskGrade = serializers.CharField(source='invoice.risk_grade')
    riskBand = serializers.CharField(source='invoice.risk_grade')
    dueDate = serializers.DateField(source='invoice.due_date')
    createdAt = serializers.DateTimeField(source='created_at')

    class Meta:
        model = ApprovalRequest
        fields = [
            'id',
            'invoiceId',
            'invoiceNumber',
            'supplierName',
            'buyerName',
            'faceValue',
            'advanceAmount',
            'netAdvance',
            'discountFee',
            'tier',
            'status',
            'riskScore',
            'riskGrade',
            'riskBand',
            'dueDate',
            'createdAt',
        ]

class ApprovalDetailSerializer(ApprovalSerializer):
    scoreFactors = serializers.JSONField(source='invoice.score_factors')
    pricingBreakdown = serializers.JSONField(source='invoice.pricing_breakdown')
    comments = serializers.CharField(allow_blank=True)
    creditMemo = serializers.CharField(source='credit_memo', allow_blank=True)
    reviewSummary = serializers.CharField(source='review_summary', allow_blank=True)

    class Meta(ApprovalSerializer.Meta):
        fields = ApprovalSerializer.Meta.fields + [
            'scoreFactors',
            'pricingBreakdown',
            'comments',
            'creditMemo',
            'reviewSummary',
        ]
