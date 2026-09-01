from rest_framework import serializers
from .models import Supplier, KycDocument

class KycDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = KycDocument
        fields = [
            'id',
            'doc_type',
            'file_name',
            'file_url',
            'is_verified',
            'verified_at',
            'notes',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'is_verified', 'verified_at']

class SupplierSerializer(serializers.ModelSerializer):
    contactEmail = serializers.EmailField(source='contact_email')
    contactPhone = serializers.CharField(source='contact_phone')
    registrationDate = serializers.DateField(source='registration_date')
    riskBand = serializers.CharField(source='risk_band')
    totalInvoices = serializers.IntegerField(source='total_invoices')
    totalOutstandingUgx = serializers.DecimalField(source='total_outstanding_ugx', max_digits=18, decimal_places=2)

    class Meta:
        model = Supplier
        fields = [
            'id',
            'name',
            'company',
            'contactEmail',
            'contactPhone',
            'registrationDate',
            'status',
            'riskBand',
            'totalInvoices',
            'totalOutstandingUgx',
            'industry',
        ]

class SupplierDetailSerializer(SupplierSerializer):
    metrics = serializers.SerializerMethodField()
    kycDocuments = KycDocumentSerializer(source='kyc_documents', many=True, read_only=True)

    class Meta(SupplierSerializer.Meta):
        fields = SupplierSerializer.Meta.fields + [
            'tin',
            'registration_number',
            'address',
            'bank_name',
            'bank_account_number',
            'bank_branch',
            'metrics',
            'kycDocuments',
        ]

    def get_metrics(self, obj):
        return {
            'totalInvoices': obj.total_invoices,
            'collectionRate': 96.5,
            'avgDaysToPayment': 42,
        }

class EligibilityCheckSerializer(serializers.Serializer):
    registeredCompany = serializers.BooleanField(required=False, default=True)
    registered_company = serializers.BooleanField(required=False, default=True)
    authorizedPerson = serializers.BooleanField(required=False, default=True)
    authorized_person = serializers.BooleanField(required=False, default=True)
    yearsInBusiness = serializers.CharField(required=False, default='2-5')
    years_in_business = serializers.CharField(required=False, default='2-5')
    revenueYear1 = serializers.DecimalField(required=False, default=150000000.0, max_digits=18, decimal_places=2)
    revenue_year1 = serializers.DecimalField(required=False, default=150000000.0, max_digits=18, decimal_places=2)
    revenueYear2 = serializers.DecimalField(required=False, default=220000000.0, max_digits=18, decimal_places=2)
    revenue_year2 = serializers.DecimalField(required=False, default=220000000.0, max_digits=18, decimal_places=2)
