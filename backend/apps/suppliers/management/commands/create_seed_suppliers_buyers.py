from decimal import Decimal
from django.core.management.base import BaseCommand
from apps.buyers.models import Buyer
from apps.suppliers.models import Supplier

class Command(BaseCommand):
    help = 'Seeds initial Ugandan corporate buyers and SME commercial suppliers'

    def handle(self, *args, **options):
        # 1. Corporate Buyers
        buyers = [
            {
                'name': 'Kakira Sugar Limited',
                'industry': 'Agribusiness & FMCG',
                'credit_limit': Decimal('2500000000.00'),
                'available_limit': Decimal('1900000000.00'),
                'payment_terms_days': 60,
                'credit_rating': 'AAA',
                'contact_person': 'Robert Patel',
                'contact_email': 'procurement@kakirasugar.com',
                'contact_phone': '+256 414 123456',
            },
            {
                'name': 'Mukwano Industries Uganda',
                'industry': 'Manufacturing & Consumer Goods',
                'credit_limit': Decimal('2000000000.00'),
                'available_limit': Decimal('1500000000.00'),
                'payment_terms_days': 45,
                'credit_rating': 'AA',
                'contact_person': 'Hassan Karmali',
                'contact_email': 'finance@mukwano.com',
                'contact_phone': '+256 414 234567',
            },
            {
                'name': 'Nile Breweries Limited',
                'industry': 'Beverages & Brewing',
                'credit_limit': Decimal('3000000000.00'),
                'available_limit': Decimal('2400000000.00'),
                'payment_terms_days': 60,
                'credit_rating': 'AAA',
                'contact_person': 'Amina Namubiru',
                'contact_email': 'payables@nilebrew.com',
                'contact_phone': '+256 414 345678',
            },
            {
                'name': 'Roofings Group Uganda',
                'industry': 'Construction & Steel',
                'credit_limit': Decimal('1800000000.00'),
                'available_limit': Decimal('1100000000.00'),
                'payment_terms_days': 90,
                'credit_rating': 'A',
                'contact_person': 'Geoffrey Lalani',
                'contact_email': 'procurement@roofings.co.ug',
                'contact_phone': '+256 414 456789',
            },
        ]

        for b in buyers:
            buyer, created = Buyer.objects.get_or_create(
                name=b['name'],
                defaults=b
            )
            status_str = 'Created' if created else 'Updated'
            self.stdout.write(self.style.SUCCESS(f"[Buyer {status_str}] {buyer.name}"))

        # 2. SME Commercial Suppliers
        suppliers = [
            {
                'company': 'Kagimu Enterprises Ltd',
                'name': 'Kagimu Charles',
                'contact_email': 'supplier@ris.ug',
                'contact_phone': '+256 772 100200',
                'tin': '1002938475',
                'registration_number': '80020001928374',
                'industry': 'Industrial Packaging',
                'status': 'active',
                'risk_band': 'low',
                'total_invoices': 14,
                'total_outstanding_ugx': Decimal('342500000.00'),
                'credit_limit_ugx': Decimal('800000000.00'),
                'bank_name': 'Stanbic Bank Uganda',
                'bank_account_number': '9030012938475',
                'bank_branch': 'Crested Towers Branch',
            },
            {
                'company': 'Victoria Nile Haulage Ltd',
                'name': 'Julius Ssempa',
                'contact_email': 'julius@victorianile.co.ug',
                'contact_phone': '+256 701 400500',
                'tin': '1008473625',
                'registration_number': '80020008473625',
                'industry': 'Freight & Logistics',
                'status': 'active',
                'risk_band': 'medium',
                'total_invoices': 8,
                'total_outstanding_ugx': Decimal('185000000.00'),
                'credit_limit_ugx': Decimal('500000000.00'),
                'bank_name': 'Centenary Bank',
                'bank_account_number': '3100094857362',
                'bank_branch': 'Mapeera House',
            },
        ]

        for s in suppliers:
            supplier, created = Supplier.objects.get_or_create(
                company=s['company'],
                defaults=s
            )
            status_str = 'Created' if created else 'Updated'
            self.stdout.write(self.style.SUCCESS(f"[Supplier {status_str}] {supplier.company}"))
