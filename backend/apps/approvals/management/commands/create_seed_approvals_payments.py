from decimal import Decimal
from django.core.management.base import BaseCommand
from django.utils import timezone
from apps.invoices.models import Invoice
from apps.approvals.models import ApprovalRequest
from apps.payments.models import PaymentRecord
from apps.authentication.models import User

class Command(BaseCommand):
    help = 'Seeds 4-tier approvals and dual-authorization payments'

    def handle(self, *args, **options):
        officer = User.objects.filter(role='credit_officer').first()
        finance_mgr = User.objects.filter(role='finance_manager').first()
        management = User.objects.filter(role='management').first()

        # Seed approvals for all non-draft invoices
        invoices = Invoice.objects.all()
        for inv in invoices:
            approval_status = 'approved' if inv.status in ['approved', 'funded', 'collecting', 'collected', 'overdue'] else 'pending'
            
            approval, created = ApprovalRequest.objects.get_or_create(
                invoice=inv,
                defaults={
                    'tier': inv.approval_tier,
                    'status': approval_status,
                    'requested_by': officer,
                    'approved_by': finance_mgr if approval_status == 'approved' else None,
                    'approved_at': timezone.now() if approval_status == 'approved' else None,
                    'comments': f"Approved per Tier {inv.approval_tier} delegation authority." if approval_status == 'approved' else "",
                }
            )

            # If invoice is approved or funded, create a payment record
            if inv.status in ['approved', 'funded', 'overdue']:
                payment_status = 'disbursed' if inv.status in ['funded', 'overdue'] else 'pending_signature'
                
                PaymentRecord.objects.get_or_create(
                    invoice=inv,
                    defaults={
                        'supplier': inv.supplier,
                        'buyer': inv.buyer,
                        'amount_ugx': inv.net_advance_ugx,
                        'provider': 'EFT',
                        'status': payment_status,
                        'dual_auth_user1': finance_mgr if payment_status == 'disbursed' else None,
                        'dual_auth_user1_at': timezone.now() if payment_status == 'disbursed' else None,
                        'dual_auth_user2': management if payment_status == 'disbursed' else None,
                        'dual_auth_user2_at': timezone.now() if payment_status == 'disbursed' else None,
                        'transaction_reference': f"EFT-BOU-{timezone.now().strftime('%Y%m%d')}-994827" if payment_status == 'disbursed' else "",
                        'funded_at': timezone.now() if payment_status == 'disbursed' else None,
                        'sla_deadline': timezone.now() + timezone.timedelta(hours=72),
                    }
                )

            status_str = 'Created' if created else 'Updated'
            self.stdout.write(self.style.SUCCESS(f"[Approval {status_str}] {inv.invoice_number} Tier {inv.approval_tier} ({approval.status})"))
