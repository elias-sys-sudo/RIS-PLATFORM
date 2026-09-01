from rest_framework import serializers
from .models import Invoice, InvoiceDocument

class InvoiceDocumentSerializer(serializers.ModelSerializer):
    docType = serializers.CharField(source='doc_type')
    fileName = serializers.CharField(source='file_name')
    fileUrl = serializers.CharField(source='file_url')
    fileSizeBytes = serializers.IntegerField(source='file_size_bytes')

    class Meta:
        model = InvoiceDocument
        fields = [
            'id',
            'docType',
            'fileName',
            'fileUrl',
            'fileSizeBytes',
            'created_at',
        ]

class InvoiceListSerializer(serializers.ModelSerializer):
    invoiceNumber = serializers.CharField(source='invoice_number')
    supplierId = serializers.UUIDField(source='supplier.id')
    supplierName = serializers.CharField(source='supplier.company')
    buyerId = serializers.UUIDField(source='buyer.id')
    buyerName = serializers.CharField(source='buyer.name')
    faceValue = serializers.DecimalField(source='face_value_ugx', max_digits=18, decimal_places=2)
    advanceAmount = serializers.DecimalField(source='advance_amount_ugx', max_digits=18, decimal_places=2)
    netAdvance = serializers.DecimalField(source='net_advance_ugx', max_digits=18, decimal_places=2)
    discountFee = serializers.DecimalField(source='discount_fee_ugx', max_digits=18, decimal_places=2)
    issueDate = serializers.DateField(source='issue_date')
    dueDate = serializers.DateField(source='due_date')
    riskScore = serializers.IntegerField(source='risk_score')
    riskGrade = serializers.CharField(source='risk_grade')
    riskBand = serializers.CharField(source='risk_grade')
    approvalTier = serializers.IntegerField(source='approval_tier')
    createdAt = serializers.DateTimeField(source='created_at')

    class Meta:
        model = Invoice
        fields = [
            'id',
            'invoiceNumber',
            'supplierId',
            'supplierName',
            'buyerId',
            'buyerName',
            'faceValue',
            'advanceAmount',
            'netAdvance',
            'discountFee',
            'issueDate',
            'dueDate',
            'status',
            'riskScore',
            'riskGrade',
            'riskBand',
            'approvalTier',
            'createdAt',
        ]

class InvoiceDetailSerializer(InvoiceListSerializer):
    advanceRatePct = serializers.DecimalField(source='advance_rate_pct', max_digits=5, decimal_places=2)
    scoreFactors = serializers.JSONField(source='score_factors')
    pricingBreakdown = serializers.JSONField(source='pricing_breakdown')
    verificationToken = serializers.CharField(source='verification_token')
    verifiedAt = serializers.DateTimeField(source='verified_at', allow_null=True)
    documents = InvoiceDocumentSerializer(many=True, read_only=True)
    rejectionReason = serializers.CharField(source='rejection_reason', allow_blank=True)

    class Meta(InvoiceListSerializer.Meta):
        fields = InvoiceListSerializer.Meta.fields + [
            'advanceRatePct',
            'scoreFactors',
            'pricingBreakdown',
            'verificationToken',
            'verifiedAt',
            'documents',
            'rejectionReason',
        ]

class CreateInvoiceSerializer(serializers.Serializer):
    buyerId = serializers.UUIDField(required=False)
    buyer_id = serializers.UUIDField(required=False)
    invoiceNumber = serializers.CharField(required=False)
    invoice_number = serializers.CharField(required=False)
    faceValue = serializers.DecimalField(required=False, max_digits=18, decimal_places=2)
    face_value = serializers.DecimalField(required=False, max_digits=18, decimal_places=2)
    issueDate = serializers.DateField(required=False)
    issue_date = serializers.DateField(required=False)
    dueDate = serializers.DateField(required=False)
    due_date = serializers.DateField(required=False)
    description = serializers.CharField(required=False, allow_blank=True)
