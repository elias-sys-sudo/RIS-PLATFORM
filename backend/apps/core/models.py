import uuid
from django.db import models
from django.utils import timezone

class TimeStampedModel(models.Model):
    """Abstract base model with automated timestamp tracking."""
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True

class UUIDModel(models.Model):
    """Abstract base model with primary key as UUID4."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True

class BaseFinancialModel(UUIDModel, TimeStampedModel):
    """Abstract base model for all core financial entities in RIS."""
    currency = models.CharField(max_length=3, default='UGX')

    class Meta:
        abstract = True
