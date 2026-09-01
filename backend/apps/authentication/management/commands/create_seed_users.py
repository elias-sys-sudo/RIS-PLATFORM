from django.core.management.base import BaseCommand
from apps.authentication.models import User

class Command(BaseCommand):
    help = 'Seeds standard institutional demo users for each platform role'

    def handle(self, *args, **options):
        seed_users = [
            {
                'email': 'supplier@ris.ug',
                'first_name': 'Kagimu',
                'last_name': 'Enterprises',
                'role': 'supplier',
                'password': 'password123',
                'is_2fa_enabled': False,
            },
            {
                'email': 'credit@ris.ug',
                'first_name': 'Sarah',
                'last_name': 'Namatovu',
                'role': 'credit_officer',
                'password': 'password123',
                'is_2fa_enabled': False,
            },
            {
                'email': 'finance@ris.ug',
                'first_name': 'David',
                'last_name': 'Mukasa',
                'role': 'finance_manager',
                'password': 'password123',
                'is_2fa_enabled': True,
                'totp_secret': 'JBSWY3DPEHPK3PXP', # Standard base32 test secret
            },
            {
                'email': 'management@ris.ug',
                'first_name': 'Grace',
                'last_name': 'Akello',
                'role': 'management',
                'password': 'password123',
                'is_2fa_enabled': True,
                'totp_secret': 'JBSWY3DPEHPK3PXP',
            },
            {
                'email': 'compliance@ris.ug',
                'first_name': 'Paul',
                'last_name': 'Okello',
                'role': 'compliance',
                'password': 'password123',
                'is_2fa_enabled': False,
            },
            {
                'email': 'legal@ris.ug',
                'first_name': 'Annet',
                'last_name': 'Tumusiime',
                'role': 'legal',
                'password': 'password123',
                'is_2fa_enabled': False,
            },
            {
                'email': 'auditor@ris.ug',
                'first_name': 'Brian',
                'last_name': 'Kato',
                'role': 'auditor',
                'password': 'password123',
                'is_2fa_enabled': False,
            },
        ]

        for u in seed_users:
            user, created = User.objects.get_or_create(
                email=u['email'],
                defaults={
                    'first_name': u['first_name'],
                    'last_name': u['last_name'],
                    'role': u['role'],
                    'is_2fa_enabled': u.get('is_2fa_enabled', False),
                    'totp_secret': u.get('totp_secret'),
                }
            )
            user.set_password(u['password'])
            user.role = u['role']
            user.first_name = u['first_name']
            user.last_name = u['last_name']
            user.is_2fa_enabled = u.get('is_2fa_enabled', False)
            user.totp_secret = u.get('totp_secret')
            user.save()

            status_str = 'Created' if created else 'Updated'
            self.stdout.write(self.style.SUCCESS(f"[{status_str}] {user.email} -> {user.role}"))
