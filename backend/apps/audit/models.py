import uuid
import hashlib
import json
from django.db import models
from django.utils import timezone
from apps.core.models import UUIDModel
from apps.authentication.models import User

GENESIS_HASH = "0" * 64

class AuditLog(UUIDModel):
    """
    Immutable Tamper-Evident SHA-256 Cryptographically Chained Audit Log.
    """
    actor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs')
    actor_email = models.CharField(max_length=255, db_index=True)
    actor_role = models.CharField(max_length=50, blank=True)

    action = models.CharField(max_length=100, db_index=True)
    resource_type = models.CharField(max_length=100, db_index=True)
    resource_id = models.CharField(max_length=100, db_index=True)
    
    payload = models.JSONField(default=dict)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    timestamp = models.DateTimeField(default=timezone.now, db_index=True)

    previous_hash = models.CharField(max_length=64, db_index=True)
    hash = models.CharField(max_length=64, unique=True, db_index=True)
    is_genesis = models.BooleanField(default=False)

    class Meta:
        verbose_name = 'Audit Log'
        verbose_name_plural = 'Audit Logs'
        ordering = ['timestamp', 'id']

    @property
    def created_at(self):
        return self.timestamp

    def calculate_hash(self) -> str:
        """Computes deterministic SHA-256 hash of the block."""
        canonical_payload = json.dumps(self.payload, sort_keys=True, separators=(',', ':'))
        raw_string = (
            f"{self.previous_hash}:"
            f"{self.timestamp.isoformat()}:"
            f"{self.actor_email}:"
            f"{self.action}:"
            f"{self.resource_type}:"
            f"{self.resource_id}:"
            f"{canonical_payload}"
        )
        return hashlib.sha256(raw_string.encode('utf-8')).hexdigest()

    def __str__(self):
        return f"[{self.timestamp.strftime('%Y-%m-%d %H:%M:%S')}] {self.action} on {self.resource_type}:{self.resource_id} by {self.actor_email}"
