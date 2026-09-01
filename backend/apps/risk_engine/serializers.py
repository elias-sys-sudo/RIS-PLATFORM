from rest_framework import serializers
from .models import RiskConfig

class RiskConfigSerializer(serializers.ModelSerializer):
    min = serializers.DecimalField(source='min_value', max_digits=18, decimal_places=4)
    max = serializers.DecimalField(source='max_value', max_digits=18, decimal_places=4)

    class Meta:
        model = RiskConfig
        fields = [
            'key',
            'label',
            'value',
            'category',
            'min',
            'max',
            'unit',
        ]
