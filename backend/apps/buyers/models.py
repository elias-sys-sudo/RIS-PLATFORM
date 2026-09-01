import uuid
from decimal import Decimal
from django.db import models
from apps.core.models import BaseFinancialModel

class Buyer(BaseFinancialModel):
    """
    Approved Corporate Obligor / Buyer Entity.
    """
    RATING_CHOICES = (
        ('AAA', 'AAA - Prime Corporate'),
        ('AA', 'AA - High Grade'),
        ('A', 'A - Upper Medium Grade'),
        ('BBB', 'BBB - Investment Grade'),
        ('BB', 'BB - Speculative Grade'),
        ('B', 'B - Highly Speculative'),
        ('CCC', 'CCC - High Default Risk'),
    )

    name = models.CharField(max_length=255, unique=True, db_index=True)
    industry = models.CharField(max_length=150, default='General Industry')
    
    credit_limit = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('1000000000.00'))
    available_limit = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('1000000000.00'))
    payment_terms_days = models.PositiveIntegerField(default=60, help_text="Standard credit terms in days")
    
    credit_rating = models.CharField(max_length=10, choices=RATING_CHOICES, default='A')
    
    contact_person = models.CharField(max_length=255, blank=True)
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=50, blank=True)
    
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = 'Corporate Buyer'
        verbose_name_plural = 'Corporate Buyers'
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.industry}) - Terms: {self.payment_terms_days}d"
