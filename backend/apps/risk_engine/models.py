from decimal import Decimal
from django.db import models
from apps.core.models import UUIDModel, TimeStampedModel

class RiskConfig(UUIDModel, TimeStampedModel):
    """
    Dynamic parameters governing algorithmic risk scoring and pricing.
    """
    CATEGORY_CHOICES = (
        ('weight', '5-Factor Risk Model Weights'),
        ('threshold', 'Operational Thresholds & Triggers'),
        ('limit', 'Facility Exposure Limits'),
        ('rate', 'Base Pricing Rates & Margins'),
    )

    key = models.CharField(max_length=100, unique=True, db_index=True)
    label = models.CharField(max_length=255)
    value = models.DecimalField(max_digits=18, decimal_places=4)
    category = models.CharField(max_length=30, choices=CATEGORY_CHOICES, default='weight')
    min_value = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('0.0'))
    max_value = models.DecimalField(max_digits=18, decimal_places=4, default=Decimal('100.0'))
    unit = models.CharField(max_length=20, default='%')

    class Meta:
        verbose_name = 'Risk Configuration'
        verbose_name_plural = 'Risk Configurations'
        ordering = ['category', 'key']

    def __str__(self):
        return f"{self.label} = {self.value} {self.unit}"
