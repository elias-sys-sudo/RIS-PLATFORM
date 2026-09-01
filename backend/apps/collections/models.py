import uuid
from decimal import Decimal
from django.db import models
from django.utils import timezone
from apps.core.models import BaseFinancialModel
from apps.invoices.models import Invoice
from apps.suppliers.models import Supplier
from apps.buyers.models import Buyer

class CollectionCase(BaseFinancialModel):
    """
    Overdue Invoice Recovery & Dunning Escalation Case.
    """
    ESCALATION_LEVELS = (
        ('none', 'Standard Monitoring'),
        ('reminder_letter', 'Stage 1 - Reminder Notice'),
        ('formal_notice', 'Stage 2 - Formal Demand Letter'),
        ('legal_action', 'Stage 3 - Legal Action Escalation'),
    )

    STATUS_CHOICES = (
        ('active', 'Active Recovery'),
        ('disputed', 'Disputed by Buyer'),
        ('resolved', 'Fully Recovered'),
        ('written_off', 'Written Off (Defaulted)'),
    )

    invoice = models.OneToOneField(Invoice, on_delete=models.CASCADE, related_name='collection_case')
    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name='collections')
    buyer = models.ForeignKey(Buyer, on_delete=models.CASCADE, related_name='collections')

    outstanding_amount_ugx = models.DecimalField(max_digits=18, decimal_places=2)
    collected_amount_ugx = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal('0.00'))
    days_overdue = models.PositiveIntegerField(default=0)
    
    escalation_level = models.CharField(max_length=30, choices=ESCALATION_LEVELS, default='none', db_index=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active', db_index=True)

    last_contact_date = models.DateTimeField(null=True, blank=True)
    next_action_date = models.DateField(null=True, blank=True)
    promise_to_pay_date = models.DateField(null=True, blank=True)
    promise_to_pay_amount_ugx = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        verbose_name = 'Collection Case'
        verbose_name_plural = 'Collection Cases'
        ordering = ['-days_overdue', '-outstanding_amount_ugx']

    def __str__(self):
        return f"Collection Case for {self.invoice.invoice_number} - Overdue {self.days_overdue}d ({self.escalation_level})"

class EscalationDocument(BaseFinancialModel):
    """
    Formal dunning and legal demand notices generated for a case.
    """
    DOC_TYPES = (
        ('reminder_letter', 'Friendly Reminder Letter'),
        ('demand_letter', 'Formal Demand Letter'),
        ('legal_notice', 'Statutory Notice of Intent to Sue'),
    )

    STATUS_CHOICES = (
        ('draft', 'Draft Preview'),
        ('finalized', 'Finalized & Signed'),
        ('sent', 'Dispatched to Debtor'),
    )

    collection_case = models.ForeignKey(CollectionCase, on_delete=models.CASCADE, related_name='documents')
    document_type = models.CharField(max_length=30, choices=DOC_TYPES, default='demand_letter')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    
    deadline_days = models.PositiveIntegerField(default=7)
    additional_notes = models.TextField(blank=True)
    generated_by = models.CharField(max_length=150, default='Credit Officer')
    finalized_by = models.CharField(max_length=150, null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'Escalation Document'
        verbose_name_plural = 'Escalation Documents'
        ordering = ['-created_at']
