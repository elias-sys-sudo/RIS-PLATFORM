from decimal import Decimal
from rest_framework import permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import RiskConfig
from .serializers import RiskConfigSerializer

class RiskConfigListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        configs = RiskConfig.objects.all()
        serializer = RiskConfigSerializer(configs, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def put(self, request):
        # Bulk or single key update
        key = request.data.get('key')
        value = request.data.get('value')

        if not key or value is None:
            return Response({'error': 'Missing key or value'}, status=status.HTTP_400_BAD_REQUEST)

        config = RiskConfig.objects.filter(key=key).first()
        if not config:
            return Response({'error': f"Parameter {key} not found."}, status=status.HTTP_404_NOT_FOUND)

        config.value = Decimal(str(value))
        config.save(update_fields=['value'])

        return Response(RiskConfigSerializer(config).data, status=status.HTTP_200_OK)

class RiskConfigDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def put(self, request, key):
        config = RiskConfig.objects.filter(key=key).first()
        if not config:
            return Response({'error': f"Parameter {key} not found."}, status=status.HTTP_404_NOT_FOUND)

        value = request.data.get('value')
        if value is None:
            return Response({'error': 'Missing value.'}, status=status.HTTP_400_BAD_REQUEST)

        config.value = Decimal(str(value))
        config.save(update_fields=['value'])

        return Response(RiskConfigSerializer(config).data, status=status.HTTP_200_OK)
