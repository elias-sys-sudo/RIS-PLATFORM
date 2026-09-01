import uuid
from decimal import Decimal
from django.db import models
from django.utils import timezone
from apps.core.models import BaseFinancialModel
from apps.suppliers.models import Supplier
from apps.buyers.models import Buyer

class Invoice(BaseFinancialModel):
    """
    Invoice entity undergoing factoring lifecycle.
    """
    STATUS_CHOICES = (
        ('draft', 'Draft'),
        ('submitted', 'Submitted'),
        ('verified', 'Verified by Buyer'),
        ('priced', 'Priced & Risk Evaluated'),
        ('approved', 'Approved for Funding'),
        ('funded', 'Funded / Disbursed'),
        ('collecting', 'In Collection'),
        ('collected', 'Fully Collected'),
        ('overdue', 'Overdue'),
        ('defaulted', 'Defaulted'),
        ('rejected', 'Rejected'),
    )

    RISK_GRADE_CHOICES = (
        ('low', 'Low Risk (Grade A)'),
        ('medium', 'Medium Risk (Grade B)'),
        ('high', 'High Risk (Grade C)'),
        ('critical', 'Critical Risk (Grade D)'),
    )

    invoice_number = models.CharField(max_length=100, unique=True, db_index=True)
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name='invoices')
    buyer = models.ForeignKey(Buyer, on_delete=models.PROTECT, related_name='invoices')

    # Core Financial Figures
    face_value_ugx = models.DecimalField(max_digits=18, decimal_places=2, help_text="Total invoice face value in UGX")
    advance_rate_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('80.00'), help_text="Percentage advance rate (e.g. 80%)")
    advance_amount_ugx = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0.00'), help_text="Gross advance payout (Face Value * Advance Rate)")
    discount_fee_ugx = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0.00'), help_text="Total factoring discount charge")
    net_advance_ugx = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0.00'), help_text="Net liquidity disbursed to supplier")

    # Dates
    issue_date = models.DateField(default=timezone.now)
    due_date = models.DateField()
    funded_at = models.DateTimeField(null=True, blank=True)
    collected_at = models.DateTimeField(null=True, blank=True)

    # State Machine
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='submitted', db_index=True)

    # Algorithmic Risk & Pricing Breakdown
    risk_score = models.PositiveIntegerField(default=75, help_text="Composite 5-factor risk score (0-100)")
    risk_grade = models.CharField(max_length=20, choices=RISK_GRADE_CHOICES, default='low')
    score_factors = models.JSONField(default=dict, blank=True, help_text="5-factor breakdown scores")
    pricing_breakdown = models.JSONField(default=dict, blank=True, help_text="Rate breakdown (Base, Spread, Margin, Annual Rate)")

    # Buyer Verification
    verification_token = models.CharField(max_length=64, unique=True, default=uuid.uuid4, db_index=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    notice_of_assignment_signed = models.BooleanField(default=False)

    # Delegation of Authority
    approval_tier = models.PositiveIntegerField(default=1, help_text="Tier 1 (<50M), Tier 2 (<200M), Tier 3 (<500M), Tier 4 (>500M)")
    rejection_reason = models.TextField(blank=True)
    credit_officer_notes = models.TextField(blank=True)

    class Meta:
        verbose_name = 'Invoice'
        verbose_name_plural = 'Invoices'
        ordering = ['-created_at']

    def calculate_tenor_days(self) -> int:
        """Calculate tenor horizon in days."""
        if not self.due_date:
            return 30
        delta = (self.due_date - self.issue_date).days
        return max(delta, 1)

    def __str__(self):
        return f"{self.invoice_number} - {self.supplier.company} -> {self.buyer.name} ({self.status})"

class InvoiceDocument(BaseFinancialModel):
    """
    Supporting commercial documents for an invoice.
    """
    DOC_TYPES = (
        ('commercial_invoice', 'Commercial Invoice'),
        ('delivery_note', 'Goods Received / Delivery Note'),
        ('purchase_order', 'Purchase Order'),
        ('notice_of_assignment', 'Notice of Assignment (Signed)'),
    )

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='documents')
    doc_type = models.CharField(max_length=50, choices=DOC_TYPES)
    file_name = models.CharField(max_length=255)
    file_url = models.CharField(max_length=500, blank=True)
    file_size_bytes = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = 'Invoice Document'
        verbose_name_plural = 'Invoice Documents'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.invoice.invoice_number} - {self.get_doc_type_display()}"
