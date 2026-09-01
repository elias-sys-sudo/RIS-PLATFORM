from rest_framework import generics, permissions
from django.db.models import Q
from .models import Buyer
from .serializers import BuyerSerializer

class BuyerListCreateView(generics.ListCreateAPIView):
    serializer_class = BuyerSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Buyer.objects.all()
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) |
                Q(industry__icontains=search)
            )
        return queryset

class BuyerDetailView(generics.RetrieveUpdateAPIView):
    queryset = Buyer.objects.all()
    serializer_class = BuyerSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = 'id'
