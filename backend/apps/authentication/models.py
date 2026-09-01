import uuid
from django.db import models
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin, BaseUserManager
from django.utils import timezone
from apps.core.models import TimeStampedModel

class UserManager(BaseUserManager):
    """Custom manager for email-based User model."""

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('The Email field must be set')
        email = self.normalize_email(email)
        extra_fields.setdefault('is_active', True)
        user = self.model(email=email, **extra_fields)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('role', 'management')

        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')

        return self.create_user(email, password, **extra_fields)

class User(AbstractBaseUser, PermissionsMixin, TimeStampedModel):
    """
    Custom user model for RIS Platform supporting 7 distinct institutional roles and 2FA TOTP.
    """
    ROLE_CHOICES = (
        ('supplier', 'Supplier / Borrower'),
        ('credit_officer', 'Credit Risk Officer'),
        ('finance_manager', 'Finance Manager'),
        ('management', 'Executive Management'),
        ('compliance', 'Compliance & AML Officer'),
        ('legal', 'Legal Counsel'),
        ('auditor', 'Internal / External Auditor'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True, db_index=True)
    first_name = models.CharField(max_length=100, blank=True)
    last_name = models.CharField(max_length=100, blank=True)
    phone_number = models.CharField(max_length=30, blank=True)
    
    role = models.CharField(max_length=30, choices=ROLE_CHOICES, default='supplier', db_index=True)
    supplier_id = models.UUIDField(null=True, blank=True, help_text="Linked supplier entity if role is supplier")
    
    # Two-Factor Authentication (TOTP)
    is_2fa_enabled = models.BooleanField(default=False)
    totp_secret = models.CharField(max_length=64, blank=True, null=True)
    
    # Status flags
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    
    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []

    class Meta:
        verbose_name = 'User'
        verbose_name_plural = 'Users'
        ordering = ['-created_at']

    @property
    def full_name(self) -> str:
        name = f"{self.first_name} {self.last_name}".strip()
        return name if name else self.email

    def __str__(self) -> str:
        return f"{self.email} ({self.get_role_display()})"
