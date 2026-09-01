import hashlib
import json
from typing import Dict, Any, Tuple
from django.utils import timezone
from django.db import transaction
from .models import AuditLog, GENESIS_HASH

def record_audit_event(
    action: str,
    resource_type: str,
    resource_id: str,
    actor=None,
    payload: Dict[str, Any] = None,
    ip_address: str = None,
) -> AuditLog:
    """
    Appends a new cryptographically signed SHA-256 audit entry to the immutable log.
    """
    if payload is None:
        payload = {}

    actor_email = actor.email if actor and hasattr(actor, 'email') else 'system'
    actor_role = actor.role if actor and hasattr(actor, 'role') else 'system'

    with transaction.atomic():
        last_entry = AuditLog.objects.select_for_update().order_by('-timestamp', '-id').first()
        prev_hash = last_entry.hash if last_entry else GENESIS_HASH
        is_genesis = (last_entry is None)

        now = timezone.now()

        entry = AuditLog(
            actor=actor if actor and hasattr(actor, 'id') else None,
            actor_email=actor_email,
            actor_role=actor_role,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id),
            payload=payload,
            ip_address=ip_address,
            timestamp=now,
            previous_hash=prev_hash,
            is_genesis=is_genesis,
        )

        entry.hash = entry.calculate_hash()
        entry.save()

        return entry

def verify_audit_chain() -> Tuple[bool, int, str]:
    """
    Validates the full SHA-256 cryptographic chain from Genesis to tip.
    Returns (is_valid: bool, total_blocks: int, error_message: str)
    """
    entries = list(AuditLog.objects.order_by('timestamp', 'id'))
    if not entries:
        return True, 0, "Audit ledger is currently empty (0 blocks)."

    expected_prev_hash = GENESIS_HASH

    for idx, entry in enumerate(entries):
        # 1. Verify previous hash pointer
        if entry.previous_hash != expected_prev_hash:
            return False, idx, f"Hash pointer broken at block {idx} (ID: {entry.id}). Expected prev {expected_prev_hash}, got {entry.previous_hash}."

        # 2. Re-compute SHA-256
        recomputed = entry.calculate_hash()
        if entry.hash != recomputed:
            return False, idx, f"Tamper detected at block {idx} (ID: {entry.id}). Recorded hash {entry.hash} does not match computed hash {recomputed}."

        expected_prev_hash = entry.hash

    return True, len(entries), f"Cryptographic audit chain verified across {len(entries)} immutable blocks. 100% integrity intact."
