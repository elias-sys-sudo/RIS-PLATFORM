from decimal import Decimal
from django.core.management.base import BaseCommand
from django.utils import timezone
from apps.risk_engine.models import RiskConfig
from apps.invoices.models import Invoice, InvoiceDocument
from apps.suppliers.models import Supplier
from apps.buyers.models import Buyer
from apps.risk_engine.scorer import evaluate_invoice_risk
from apps.pricing.calculator import calculate_invoice_pricing

class Command(BaseCommand):
    help = 'Seeds risk parameters and realistic factoring invoices'

    def handle(self, *args, **options):
        # 1. Risk Parameters
        risk_configs = [
            # Weights
            {'key': 'weight_buyer_rating', 'label': 'Buyer Credit Rating Weight', 'value': Decimal('35.00'), 'category': 'weight', 'min_value': Decimal('10.00'), 'max_value': Decimal('60.00'), 'unit': '%'},
            {'key': 'weight_tenor', 'label': 'Tenor / Maturity Horizon Weight', 'value': Decimal('20.00'), 'category': 'weight', 'min_value': Decimal('5.00'), 'max_value': Decimal('40.00'), 'unit': '%'},
            {'key': 'weight_supplier_track', 'label': 'Supplier Historical Track Record', 'value': Decimal('20.00'), 'category': 'weight', 'min_value': Decimal('5.00'), 'max_value': Decimal('40.00'), 'unit': '%'},
            {'key': 'weight_concentration', 'label': 'Single Obligor Concentration Weight', 'value': Decimal('15.00'), 'category': 'weight', 'min_value': Decimal('5.00'), 'max_value': Decimal('30.00'), 'unit': '%'},
            {'key': 'weight_collateral', 'label': 'Collateral & Recourse Score Weight', 'value': Decimal('10.00'), 'category': 'weight', 'min_value': Decimal('0.00'), 'max_value': Decimal('25.00'), 'unit': '%'},
            # Thresholds
            {'key': 'threshold_stp_score', 'label': 'Straight-Through Processing Score Trigger', 'value': Decimal('85.00'), 'category': 'threshold', 'min_value': Decimal('70.00'), 'max_value': Decimal('95.00'), 'unit': 'Score'},
            {'key': 'threshold_aml_alert', 'label': 'High-Value AML Enhanced Due Diligence', 'value': Decimal('100000000.00'), 'category': 'threshold', 'min_value': Decimal('50000000.00'), 'max_value': Decimal('500000000.00'), 'unit': 'UGX'},
            # Limits
            {'key': 'limit_single_obligor_cap', 'label': 'Maximum Single-Buyer Exposure Ceiling', 'value': Decimal('3000000000.00'), 'category': 'limit', 'min_value': Decimal('500000000.00'), 'max_value': Decimal('10000000000.00'), 'unit': 'UGX'},
            {'key': 'limit_max_tenor_days', 'label': 'Maximum Allowable Tenor Horizon', 'value': Decimal('90.00'), 'category': 'limit', 'min_value': Decimal('30.00'), 'max_value': Decimal('180.00'), 'unit': 'Days'},
            # Rates
            {'key': 'rate_bank_benchmark', 'label': 'Partner Bank Benchmark Cost of Funds', 'value': Decimal('12.00'), 'category': 'rate', 'min_value': Decimal('8.00'), 'max_value': Decimal('18.00'), 'unit': '%'},
            {'key': 'rate_platform_margin', 'label': 'Platform Gross Margin Rate', 'value': Decimal('2.00'), 'category': 'rate', 'min_value': Decimal('1.00'), 'max_value': Decimal('5.00'), 'unit': '%'},
        ]

        for cfg in risk_configs:
            obj, created = RiskConfig.objects.get_or_create(
                key=cfg['key'],
                defaults=cfg
            )
            status_str = 'Created' if created else 'Updated'
            self.stdout.write(self.style.SUCCESS(f"[RiskConfig {status_str}] {obj.key}"))

        # 2. Invoices
        supplier1 = Supplier.objects.filter(company='Kagimu Enterprises Ltd').first()
        supplier2 = Supplier.objects.filter(company='Victoria Nile Haulage Ltd').first() or supplier1
        buyer1 = Buyer.objects.filter(name='Kakira Sugar Limited').first()
        buyer2 = Buyer.objects.filter(name='Mukwano Industries Uganda').first()
        buyer3 = Buyer.objects.filter(name='Nile Breweries Limited').first()

        if not (supplier1 and buyer1 and buyer2 and buyer3):
            self.stdout.write(self.style.WARNING("Please run create_seed_suppliers_buyers first."))
            return

        invoices_data = [
            {
                'invoice_number': 'INV-2026-0041',
                'supplier': supplier1,
                'buyer': buyer1,
                'face_value_ugx': Decimal('185000000.00'),
                'issue_date': timezone.now().date() - timezone.timedelta(days=15),
                'due_date': timezone.now().date() + timezone.timedelta(days=45),
                'status': 'submitted',
            },
            {
                'invoice_number': 'INV-2026-0042',
                'supplier': supplier1,
                'buyer': buyer2,
                'face_value_ugx': Decimal('250000000.00'),
                'issue_date': timezone.now().date() - timezone.timedelta(days=10),
                'due_date': timezone.now().date() + timezone.timedelta(days=50),
                'status': 'verified',
                'verified_at': timezone.now(),
                'notice_of_assignment_signed': True,
            },
            {
                'invoice_number': 'INV-2026-0043',
                'supplier': supplier2,
                'buyer': buyer3,
                'face_value_ugx': Decimal('85000000.00'),
                'issue_date': timezone.now().date() - timezone.timedelta(days=5),
                'due_date': timezone.now().date() + timezone.timedelta(days=25),
                'status': 'priced',
                'verified_at': timezone.now(),
                'notice_of_assignment_signed': True,
            },
            {
                'invoice_number': 'INV-2026-0044',
                'supplier': supplier1,
                'buyer': buyer3,
                'face_value_ugx': Decimal('420000000.00'),
                'issue_date': timezone.now().date() - timezone.timedelta(days=2),
                'due_date': timezone.now().date() + timezone.timedelta(days=58),
                'status': 'approved',
                'verified_at': timezone.now(),
                'notice_of_assignment_signed': True,
            },
            {
                'invoice_number': 'INV-2026-0038',
                'supplier': supplier1,
                'buyer': buyer1,
                'face_value_ugx': Decimal('120000000.00'),
                'issue_date': timezone.now().date() - timezone.timedelta(days=45),
                'due_date': timezone.now().date() + timezone.timedelta(days=15),
                'status': 'funded',
                'funded_at': timezone.now() - timezone.timedelta(days=40),
                'verified_at': timezone.now() - timezone.timedelta(days=43),
                'notice_of_assignment_signed': True,
            },
            {
                'invoice_number': 'INV-2026-0035',
                'supplier': supplier2,
                'buyer': buyer2,
                'face_value_ugx': Decimal('95000000.00'),
                'issue_date': timezone.now().date() - timezone.timedelta(days=70),
                'due_date': timezone.now().date() - timezone.timedelta(days=10),
                'status': 'overdue',
                'funded_at': timezone.now() - timezone.timedelta(days=65),
                'verified_at': timezone.now() - timezone.timedelta(days=68),
                'notice_of_assignment_signed': True,
            },
        ]

        for inv_dict in invoices_data:
            inv, created = Invoice.objects.get_or_create(
                invoice_number=inv_dict['invoice_number'],
                defaults=inv_dict
            )

            # Evaluate scoring & pricing
            score, grade, factors = evaluate_invoice_risk(inv)
            inv.risk_score = score
            inv.risk_grade = grade
            inv.score_factors = factors

            pricing = calculate_invoice_pricing(inv, risk_grade=grade)
            inv.pricing_breakdown = pricing
            inv.advance_rate_pct = Decimal(str(pricing['advanceRatePct']))
            inv.advance_amount_ugx = Decimal(str(pricing['advanceAmountUgx']))
            inv.discount_fee_ugx = Decimal(str(pricing['discountFeeUgx']))
            inv.net_advance_ugx = Decimal(str(pricing['netAdvanceUgx']))

            if inv.face_value_ugx < Decimal('50000000'):
                inv.approval_tier = 1
            elif inv.face_value_ugx < Decimal('200000000'):
                inv.approval_tier = 2
            elif inv.face_value_ugx < Decimal('500000000'):
                inv.approval_tier = 3
            else:
                inv.approval_tier = 4

            inv.save()

            # Add documents
            InvoiceDocument.objects.get_or_create(
                invoice=inv,
                doc_type='commercial_invoice',
                defaults={
                    'file_name': f"{inv.invoice_number}_commercial_invoice.pdf",
                    'file_url': '/media/invoices/mock_invoice.pdf',
                    'file_size_bytes': 1024 * 420,
                }
            )
            InvoiceDocument.objects.get_or_create(
                invoice=inv,
                doc_type='delivery_note',
                defaults={
                    'file_name': f"{inv.invoice_number}_delivery_receipt.pdf",
                    'file_url': '/media/invoices/mock_delivery.pdf',
                    'file_size_bytes': 1024 * 280,
                }
            )

            status_str = 'Created' if created else 'Updated'
            self.stdout.write(self.style.SUCCESS(f"[Invoice {status_str}] {inv.invoice_number} ({inv.status}) -> Score: {inv.risk_score} (Tier {inv.approval_tier})"))
