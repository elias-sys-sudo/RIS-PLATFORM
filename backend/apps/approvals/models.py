import uuid
from django.db import models
from django.utils import timezone
from apps.core.models import BaseFinancialModel
from apps.invoices.models import Invoice
from apps.authentication.models import User

class ApprovalRequest(BaseFinancialModel):
    """
    Formal 4-Tier Credit Approval Request.
    """
    STATUS_CHOICES = (
        ('pending', 'Pending Review'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('info_requested', 'Information Requested'),
    )

    invoice = models.OneToOneField(Invoice, on_delete=models.CASCADE, related_name='approval_request')
    tier = models.PositiveIntegerField(default=1, help_text="Delegation Tier (1 to 4)")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', db_index=True)

    requested_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='submitted_approvals')
    approved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='reviewed_approvals')
    approved_at = models.DateTimeField(null=True, blank=True)

    comments = models.TextField(blank=True)
    credit_memo = models.TextField(blank=True)
    review_summary = models.TextField(blank=True)

    class Meta:
        verbose_name = 'Approval Request'
        verbose_name_plural = 'Approval Requests'
        ordering = ['-created_at']

    def __str__(self):
        return f"Tier {self.tier} Approval for {self.invoice.invoice_number} ({self.status})"
