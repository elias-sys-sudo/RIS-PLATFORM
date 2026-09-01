import uuid
from decimal import Decimal
from django.db import models
from django.utils import timezone
from apps.core.models import BaseFinancialModel
from apps.invoices.models import Invoice
from apps.suppliers.models import Supplier
from apps.buyers.models import Buyer
from apps.authentication.models import User

class PaymentRecord(BaseFinancialModel):
    """
    Dual-Authorization Payment Disbursement Record.
    """
    STATUS_CHOICES = (
        ('pending_signature', 'Needs 1st Signature'),
        ('partially_signed', 'Needs 2nd Signature'),
        ('authorized', 'Dual-Authorized'),
        ('processing', 'Processing Rail Execution'),
        ('disbursed', 'Disbursed to Supplier'),
        ('failed', 'Execution Failed'),
    )

    PROVIDER_CHOICES = (
        ('EFT', 'Bank EFT (Bank of Uganda ACH)'),
        ('MTN_MOMO', 'MTN Mobile Money'),
        ('AIRTEL', 'Airtel Money'),
        ('MOCK', 'Mock Simulation Rail'),
    )

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='payments')
    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name='payments')
    buyer = models.ForeignKey(Buyer, on_delete=models.CASCADE, related_name='payments')

    amount_ugx = models.DecimalField(max_digits=18, decimal_places=2, help_text="Net advance payout in UGX")
    provider = models.CharField(max_length=30, choices=PROVIDER_CHOICES, default='EFT')
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='pending_signature', db_index=True)

    # Two-Officer Dual Signatures
    dual_auth_user1 = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='payment_sign_1')
    dual_auth_user1_at = models.DateTimeField(null=True, blank=True)
    dual_auth_user2 = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='payment_sign_2')
    dual_auth_user2_at = models.DateTimeField(null=True, blank=True)

    transaction_reference = models.CharField(max_length=100, blank=True)
    funded_at = models.DateTimeField(null=True, blank=True)
    failure_reason = models.TextField(blank=True)
    sla_deadline = models.DateTimeField(help_text="72-hour disbursement SLA deadline")

    class Meta:
        verbose_name = 'Payment Record'
        verbose_name_plural = 'Payment Records'
        ordering = ['-created_at']

    def __str__(self):
        return f"Payment {self.id} for {self.invoice.invoice_number} - {self.amount_ugx} UGX ({self.status})"
