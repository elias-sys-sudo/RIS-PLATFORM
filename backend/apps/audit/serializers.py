from rest_framework import serializers
from .models import AuditLog

class AuditLogSerializer(serializers.ModelSerializer):
    actorEmail = serializers.CharField(source='actor_email')
    actorRole = serializers.CharField(source='actor_role')
    resourceType = serializers.CharField(source='resource_type')
    resourceId = serializers.CharField(source='resource_id')
    ipAddress = serializers.CharField(source='ip_address', allow_null=True)
    previousHash = serializers.CharField(source='previous_hash')

    class Meta:
        model = AuditLog
        fields = [
            'id',
            'actorEmail',
            'actorRole',
            'action',
            'resourceType',
            'resourceId',
            'payload',
            'ipAddress',
            'timestamp',
            'previousHash',
            'hash',
            'is_genesis',
        ]
