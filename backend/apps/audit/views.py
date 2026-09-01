from rest_framework import permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.db.models import Q
from django.utils import timezone

from .models import AuditLog
from .serializers import AuditLogSerializer
from .engine import verify_audit_chain

class AuditLogsListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        queryset = AuditLog.objects.all().order_by('-timestamp')

        action = request.query_params.get('action')
        if action and action != 'all':
            queryset = queryset.filter(action=action)

        actor = request.query_params.get('actor')
        if actor:
            queryset = queryset.filter(actor_email__icontains=actor)

        resource_type = request.query_params.get('resourceType') or request.query_params.get('resource_type')
        if resource_type:
            queryset = queryset.filter(resource_type=resource_type)

        search = request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(action__icontains=search) |
                Q(actor_email__icontains=search) |
                Q(resource_id__icontains=search) |
                Q(hash__icontains=search)
            )

        serializer = AuditLogSerializer(queryset[:100], many=True)

        return Response({
            'data': serializer.data,
            'total': queryset.count(),
            'page': 1,
            'totalPages': 1,
        }, status=status.HTTP_200_OK)

class AuditVerifyChainView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        is_valid, total_blocks, message = verify_audit_chain()

        return Response({
            'isValid': is_valid,
            'totalBlocks': total_blocks,
            'message': message,
            'verifiedAt': timezone.now().isoformat(),
            'algorithm': 'SHA-256 Chained Hash Tree',
        }, status=status.HTTP_200_OK if is_valid else status.HTTP_409_CONFLICT)
