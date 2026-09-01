from decimal import Decimal
from django.core.management.base import BaseCommand
from django.utils import timezone
from apps.invoices.models import Invoice
from apps.collections.models import CollectionCase, EscalationDocument
from apps.settlements.models import Settlement

class Command(BaseCommand):
    help = 'Seeds collection recovery cases and waterfall settlements'

    def handle(self, *args, **options):
        # 1. Collection Case for Overdue Invoice
        overdue_inv = Invoice.objects.filter(status='overdue').first()
        if overdue_inv:
            case, created = CollectionCase.objects.get_or_create(
                invoice=overdue_inv,
                defaults={
                    'supplier': overdue_inv.supplier,
                    'buyer': overdue_inv.buyer,
                    'outstanding_amount_ugx': overdue_inv.face_value_ugx,
                    'collected_amount_ugx': Decimal('0.00'),
                    'days_overdue': 10,
                    'escalation_level': 'reminder_letter',
                    'status': 'active',
                    'last_contact_date': timezone.now() - timezone.timedelta(days=2),
                    'next_action_date': timezone.now().date() + timezone.timedelta(days=3),
                    'notes': 'Debtor accounts payable contacted. Promised payment next week.',
                }
            )

            # Add sample dunning document
            EscalationDocument.objects.get_or_create(
                collection_case=case,
                document_type='reminder_letter',
                defaults={
                    'status': 'sent',
                    'deadline_days': 7,
                    'additional_notes': '1st friendly reminder regarding payment of invoice.',
                    'generated_by': 'Credit Recovery Officer',
                    'sent_at': timezone.now() - timezone.timedelta(days=2),
                }
            )
            self.stdout.write(self.style.SUCCESS(f"[Collection Case] {overdue_inv.invoice_number} (Overdue 10d, Reminder Sent)"))

        # 2. Settlement Records for funded / settled invoices
        funded_inv = Invoice.objects.filter(status='funded').first()
        if funded_inv:
            discount_earned = funded_inv.discount_fee_ugx
            net_profit = discount_earned * Decimal('0.65')
            bank_cost = discount_earned - net_profit

            settlement, created = Settlement.objects.get_or_create(
                invoice=funded_inv,
                defaults={
                    'supplier': funded_inv.supplier,
                    'buyer': funded_inv.buyer,
                    'face_value_ugx': funded_inv.face_value_ugx,
                    'collected_amount_ugx': funded_inv.face_value_ugx,
                    'advance_amount_ugx': funded_inv.net_advance_ugx,
                    'discount_earned_ugx': discount_earned,
                    'facility_repayment_ugx': funded_inv.net_advance_ugx,
                    'bank_cost_paid_ugx': bank_cost,
                    'net_profit_ugx': net_profit,
                    'status': 'facility_repaid',
                    'settled_at': timezone.now() - timezone.timedelta(days=1),
                    'bank_reference': 'STANBIC-FAC-REPAY-99281',
                }
            )
            self.stdout.write(self.style.SUCCESS(f"[Settlement] {funded_inv.invoice_number} -> Facility Repaid, Margin: {settlement.net_profit_ugx} UGX"))
