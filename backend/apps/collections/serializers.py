from rest_framework import serializers
from .models import CollectionCase, EscalationDocument

class EscalationDocumentSerializer(serializers.ModelSerializer):
    documentType = serializers.CharField(source='document_type')
    draftParams = serializers.SerializerMethodField()
    generatedBy = serializers.CharField(source='generated_by')
    finalizedBy = serializers.CharField(source='finalized_by', allow_null=True)
    sentAt = serializers.DateTimeField(source='sent_at', allow_null=True)
    createdAt = serializers.DateTimeField(source='created_at')

    class Meta:
        model = EscalationDocument
        fields = [
            'id',
            'documentType',
            'status',
            'draftParams',
            'generatedBy',
            'finalizedBy',
            'sentAt',
            'createdAt',
        ]

    def get_draftParams(self, obj):
        return {
            'deadlineDays': obj.deadline_days,
            'additionalNotes': obj.additional_notes,
        }

class CollectionSerializer(serializers.ModelSerializer):
    invoiceId = serializers.UUIDField(source='invoice.id')
    invoiceNumber = serializers.CharField(source='invoice.invoice_number')
    supplierName = serializers.CharField(source='supplier.company')
    buyerName = serializers.CharField(source='buyer.name')
    faceValue = serializers.DecimalField(source='invoice.face_value_ugx', max_digits=18, decimal_places=2)
    outstandingAmount = serializers.DecimalField(source='outstanding_amount_ugx', max_digits=18, decimal_places=2)
    collectedAmount = serializers.DecimalField(source='collected_amount_ugx', max_digits=18, decimal_places=2)
    daysOverdue = serializers.IntegerField(source='days_overdue')
    escalationLevel = serializers.CharField(source='escalation_level')
    dueDate = serializers.DateField(source='invoice.due_date')
    createdAt = serializers.DateTimeField(source='created_at')

    class Meta:
        model = CollectionCase
        fields = [
            'id',
            'invoiceId',
            'invoiceNumber',
            'supplierName',
            'buyerName',
            'faceValue',
            'outstandingAmount',
            'collectedAmount',
            'daysOverdue',
            'escalationLevel',
            'status',
            'dueDate',
            'createdAt',
        ]

class CollectionDetailSerializer(CollectionSerializer):
    buyerEmail = serializers.EmailField(source='buyer.contact_email', allow_blank=True)
    buyerPhone = serializers.CharField(source='buyer.contact_phone', allow_blank=True)
    lastContactDate = serializers.DateTimeField(source='last_contact_date', allow_null=True)
    nextActionDate = serializers.DateField(source='next_action_date', allow_null=True)
    promiseToPayDate = serializers.DateField(source='promise_to_pay_date', allow_null=True)
    promiseToPayAmount = serializers.DecimalField(source='promise_to_pay_amount_ugx', max_digits=18, decimal_places=2, allow_null=True)
    documents = EscalationDocumentSerializer(many=True, read_only=True)

    class Meta(CollectionSerializer.Meta):
        fields = CollectionSerializer.Meta.fields + [
            'buyerEmail',
            'buyerPhone',
            'lastContactDate',
            'nextActionDate',
            'promiseToPayDate',
            'promiseToPayAmount',
            'notes',
            'documents',
        ]
