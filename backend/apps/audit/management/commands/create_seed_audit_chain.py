from django.core.management.base import BaseCommand
from apps.audit.engine import record_audit_event, verify_audit_chain
from apps.authentication.models import User
from apps.invoices.models import Invoice

class Command(BaseCommand):
    help = 'Seeds cryptographic SHA-256 chained audit blocks and validates chain integrity'

    def handle(self, *args, **options):
        supplier_user = User.objects.filter(role='supplier').first()
        officer_user = User.objects.filter(role='credit_officer').first()
        finance_user = User.objects.filter(role='finance_manager').first()
        invoice = Invoice.objects.first()

        inv_id = str(invoice.id) if invoice else "inv_demo_001"
        inv_num = invoice.invoice_number if invoice else "INV-2026-0041"

        # Block 1 (Genesis) - Supplier uploads invoice
        b1 = record_audit_event(
            action='INVOICE_SUBMITTED',
            resource_type='Invoice',
            resource_id=inv_id,
            actor=supplier_user,
            payload={'invoiceNumber': inv_num, 'faceValue': 185000000.0, 'supplier': 'Kagimu Enterprises Ltd'},
            ip_address='197.239.4.12',
        )
        self.stdout.write(self.style.SUCCESS(f"[Genesis Block 0] Hash: {b1.hash[:16]}..."))

        # Block 2 - Buyer confirms Notice of Assignment
        b2 = record_audit_event(
            action='NOTICE_OF_ASSIGNMENT_CONFIRMED',
            resource_type='Invoice',
            resource_id=inv_id,
            actor=None,
            payload={'buyer': 'Kakira Sugar Limited', 'tokenVerified': True},
            ip_address='154.72.196.44',
        )
        self.stdout.write(self.style.SUCCESS(f"[Block 1] Hash: {b2.hash[:16]}... (Linked to {b2.previous_hash[:16]}...)"))

        # Block 3 - Credit Officer evaluates risk
        b3 = record_audit_event(
            action='RISK_SCORING_EVALUATED',
            resource_type='Invoice',
            resource_id=inv_id,
            actor=officer_user,
            payload={'riskScore': 90, 'riskGrade': 'low', 'approvalTier': 2},
            ip_address='102.219.12.8',
        )
        self.stdout.write(self.style.SUCCESS(f"[Block 2] Hash: {b3.hash[:16]}... (Linked to {b3.previous_hash[:16]}...)"))

        # Block 4 - Dual Authorization Sign-Off
        b4 = record_audit_event(
            action='PAYMENT_DUAL_AUTHORIZED',
            resource_type='PaymentRecord',
            resource_id=f"pay_{inv_id[:8]}",
            actor=finance_user,
            payload={'amountUgx': 148000000.0, 'rail': 'EFT', 'status': 'disbursed'},
            ip_address='102.219.12.9',
        )
        self.stdout.write(self.style.SUCCESS(f"[Block 3] Hash: {b4.hash[:16]}... (Linked to {b4.previous_hash[:16]}...)"))

        # Verify full chain integrity
        is_valid, count, msg = verify_audit_chain()
        if is_valid:
            self.stdout.write(self.style.SUCCESS(f"Verification: {msg}"))
        else:
            self.stdout.write(self.style.ERROR(f"Integrity Error: {msg}"))
