from rest_framework import serializers
from .models import Buyer

class BuyerSerializer(serializers.ModelSerializer):
    creditLimit = serializers.DecimalField(source='credit_limit', max_digits=18, decimal_places=2)
    availableLimit = serializers.DecimalField(source='available_limit', max_digits=18, decimal_places=2, required=False)
    paymentTermsDays = serializers.IntegerField(source='payment_terms_days')
    contactPerson = serializers.CharField(source='contact_person', required=False, allow_blank=True)
    contactEmail = serializers.EmailField(source='contact_email', required=False, allow_blank=True)
    contactPhone = serializers.CharField(source='contact_phone', required=False, allow_blank=True)

    class Meta:
        model = Buyer
        fields = [
            'id',
            'name',
            'industry',
            'creditLimit',
            'availableLimit',
            'paymentTermsDays',
            'credit_rating',
            'contactPerson',
            'contactEmail',
            'contactPhone',
            'is_active',
        ]
