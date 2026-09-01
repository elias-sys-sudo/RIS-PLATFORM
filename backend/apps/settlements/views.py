from decimal import Decimal
from django.utils import timezone
from rest_framework import permissions, status, generics
from rest_framework.views import APIView
from rest_framework.response import Response
from django.db.models import Q, Sum

from .models import Settlement
from .serializers import SettlementSerializer

class SettlementsListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        queryset = Settlement.objects.select_related(
            'invoice', 'supplier', 'buyer'
        ).all()

        status_param = request.query_params.get('status')
        if status_param and status_param != 'all':
            queryset = queryset.filter(status=status_param)

        search = request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(invoice__invoice_number__icontains=search) |
                Q(supplier__company__icontains=search) |
                Q(buyer__name__icontains=search)
            )

        # Summary KPIs
        total_profit = queryset.aggregate(s=Sum('net_profit_ugx'))['s'] or Decimal('0.00')
        total_repaid = queryset.aggregate(s=Sum('facility_repayment_ugx'))['s'] or Decimal('0.00')
        pending_count = queryset.filter(status='pending').count()

        summary = {
            'totalSettlements': queryset.count(),
            'totalNetProfit': float(total_profit),
            'totalFacilityRepaid': float(total_repaid),
            'pendingCount': pending_count,
        }

        serializer = SettlementSerializer(queryset, many=True)

        return Response({
            'data': serializer.data,
            'total': queryset.count(),
            'page': 1,
            'totalPages': 1,
            'pageSize': 20,
            'summary': summary,
        }, status=status.HTTP_200_OK)

class SettlementDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, id):
        settlement = generics.get_object_or_404(
            Settlement.objects.select_related('invoice', 'supplier', 'buyer'),
            id=id
        )
        return Response({'data': SettlementSerializer(settlement).data}, status=status.HTTP_200_OK)

class RepayFacilityActionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        settlement = generics.get_object_or_404(Settlement, id=id)
        repayment_amount = Decimal(str(request.data.get('facility_repayment_amount') or request.data.get('facilityRepaymentAmount') or settlement.advance_amount_ugx))
        
        settlement.facility_repayment_ugx = repayment_amount
        settlement.status = 'facility_repaid'
        settlement.bank_reference = f"STANBIC-SETTLE-{timezone.now().strftime('%Y%m%d')}-0091"
        settlement.save()

        return Response({'data': SettlementSerializer(settlement).data}, status=status.HTTP_200_OK)

class BookProfitActionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        settlement = generics.get_object_or_404(Settlement, id=id)
        discount_earned = Decimal(str(request.data.get('discount_earned') or request.data.get('discountEarned') or settlement.discount_earned_ugx))
        bank_cost = Decimal(str(request.data.get('bank_cost_paid') or request.data.get('bankCostPaid') or settlement.bank_cost_paid_ugx))

        settlement.discount_earned_ugx = discount_earned
        settlement.bank_cost_paid_ugx = bank_cost
        settlement.net_profit_ugx = discount_earned - bank_cost
        settlement.status = 'profit_booked'
        settlement.settled_at = timezone.now()
        settlement.save()

        return Response({'data': SettlementSerializer(settlement).data}, status=status.HTTP_200_OK)

class CloseSettlementActionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, id):
        settlement = generics.get_object_or_404(Settlement, id=id)
        settlement.status = 'closed'
        settlement.settled_at = timezone.now()
        settlement.save()

        return Response({'data': SettlementSerializer(settlement).data}, status=status.HTTP_200_OK)
