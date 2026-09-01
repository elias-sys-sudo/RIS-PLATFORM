import uuid
from decimal import Decimal
from django.db import models
from django.utils import timezone
from apps.core.models import BaseFinancialModel, TimeStampedModel

class Supplier(BaseFinancialModel):
    """
    SME Commercial Supplier / Borrower Entity.
    """
    STATUS_CHOICES = (
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('suspended', 'Suspended'),
    )

    RISK_BAND_CHOICES = (
        ('low', 'Low Risk (Tier 1)'),
        ('medium', 'Medium Risk (Tier 2)'),
        ('high', 'High Risk (Tier 3)'),
        ('critical', 'Critical Risk (Tier 4)'),
    )

    # Company Details
    company = models.CharField(max_length=255, db_index=True)
    registration_number = models.CharField(max_length=100, blank=True)
    tin = models.CharField(max_length=50, blank=True, help_text="URA Tax Identification Number")
    industry = models.CharField(max_length=100, default='General Commerce')
    address = models.TextField(blank=True)

    # Contact Person
    name = models.CharField(max_length=255, help_text="Contact person's full name")
    contact_email = models.EmailField(db_index=True)
    contact_phone = models.CharField(max_length=50, blank=True)

    # Financial Exposure & Metrics
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active', db_index=True)
    risk_band = models.CharField(max_length=20, choices=RISK_BAND_CHOICES, default='low', db_index=True)
    
    total_invoices = models.PositiveIntegerField(default=0)
    total_outstanding_ugx = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0.00'))
    credit_limit_ugx = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('500000000.00'))
    
    # Banking payout coordinates
    bank_name = models.CharField(max_length=150, blank=True)
    bank_account_number = models.CharField(max_length=100, blank=True)
    bank_branch = models.CharField(max_length=100, blank=True)
    
    registration_date = models.DateField(default=timezone.now)

    class Meta:
        verbose_name = 'Supplier'
        verbose_name_plural = 'Suppliers'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.company} ({self.name})"

class KycDocument(BaseFinancialModel):
    """
    KYC compliance documents uploaded by SME suppliers.
    """
    DOC_TYPES = (
        ('certificate_of_incorporation', 'Certificate of Incorporation'),
        ('tax_clearance', 'URA Tax Clearance Certificate'),
        ('bank_statements_6m', '6-Month Certified Bank Statements'),
        ('director_id', 'Director National ID / Passport'),
        ('trading_license', 'Trading License'),
    )

    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name='kyc_documents')
    doc_type = models.CharField(max_length=50, choices=DOC_TYPES)
    file_name = models.CharField(max_length=255)
    file_url = models.CharField(max_length=500, blank=True)
    
    is_verified = models.BooleanField(default=False)
    verified_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        verbose_name = 'KYC Document'
        verbose_name_plural = 'KYC Documents'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.supplier.company} - {self.get_doc_type_display()}"
