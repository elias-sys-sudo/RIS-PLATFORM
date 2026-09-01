import uuid
from decimal import Decimal
from django.db import models
from django.utils import timezone
from apps.core.models import BaseFinancialModel
from apps.invoices.models import Invoice
from apps.suppliers.models import Supplier
from apps.buyers.models import Buyer

class Settlement(BaseFinancialModel):
    """
    Automated 3-Step Waterfall Settlement & Profit Booking Ledger.
    """
    STATUS_CHOICES = (
        ('pending', 'Pending Repayment Allocation'),
        ('facility_repaid', 'Partner Bank Facility Repaid'),
        ('profit_booked', 'Platform Gross Margin Realized'),
        ('closed', 'Settlement Ledger Closed & Audited'),
    )

    invoice = models.OneToOneField(Invoice, on_delete=models.CASCADE, related_name='settlement')
    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name='settlements')
    buyer = models.ForeignKey(Buyer, on_delete=models.CASCADE, related_name='settlements')

    # Core Waterfall Financial Figures
    face_value_ugx = models.DecimalField(max_digits=18, decimal_places=2)
    collected_amount_ugx = models.DecimalField(max_digits=18, decimal_places=2)
    advance_amount_ugx = models.DecimalField(max_digits=18, decimal_places=2)
    
    discount_earned_ugx = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0.00'))
    penalty_income_ugx = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0.00'))
    facility_repayment_ugx = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0.00'))
    bank_cost_paid_ugx = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0.00'))
    net_profit_ugx = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0.00'))

    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='pending', db_index=True)
    collected_at = models.DateTimeField(default=timezone.now)
    settled_at = models.DateTimeField(null=True, blank=True)

    bank_reference = models.CharField(max_length=100, blank=True)
    accounting_notes = models.TextField(blank=True)

    class Meta:
        verbose_name = 'Settlement Record'
        verbose_name_plural = 'Settlement Records'
        ordering = ['-created_at']

    def __str__(self):
        return f"Settlement for {self.invoice.invoice_number} - Net Profit: {self.net_profit_ugx} UGX ({self.status})"
