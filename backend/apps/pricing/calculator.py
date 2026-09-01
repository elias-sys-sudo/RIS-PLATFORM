from decimal import Decimal
from typing import Dict, Any

def calculate_invoice_pricing(invoice, risk_grade: str = 'low') -> Dict[str, Any]:
    """
    Computes transparent rate decomposition and financial advance figures.
    """
    face_value = invoice.face_value_ugx
    tenor_days = invoice.calculate_tenor_days()

    # 1. Base Benchmark Cost of Funds (12.00% p.a.)
    base_rate = Decimal('12.00')

    # 2. Risk Premium Spread
    premium_map = {
        'low': Decimal('1.50'),
        'medium': Decimal('2.75'),
        'high': Decimal('4.50'),
        'critical': Decimal('6.50'),
    }
    risk_premium = premium_map.get(risk_grade, Decimal('2.50'))

    # 3. Platform Operating Margin
    platform_margin = Decimal('2.00')

    # Total Annualized Discount Rate
    total_annual_rate = base_rate + risk_premium + platform_margin

    # Advance Rate
    advance_rate = Decimal('85.00') if risk_grade == 'low' else Decimal('80.00')
    advance_amount = (face_value * advance_rate) / Decimal('100.00')

    # Discount Fee = Face Value * Total Annual Rate * (Tenor / 365)
    tenor_factor = Decimal(str(tenor_days)) / Decimal('365.0')
    discount_fee = (face_value * (total_annual_rate / Decimal('100.00')) * tenor_factor)
    discount_fee = discount_fee.quantize(Decimal('0.01'))

    # Net Advance Payout
    net_advance = advance_amount - discount_fee
    if net_advance < Decimal('0'):
        net_advance = Decimal('0.00')

    breakdown = {
        'baseBenchmarkRatePct': float(base_rate),
        'riskPremiumRatePct': float(risk_premium),
        'platformMarginPct': float(platform_margin),
        'totalAnnualDiscountRatePct': float(total_annual_rate),
        'tenorDays': tenor_days,
        'advanceRatePct': float(advance_rate),
        'advanceAmountUgx': float(advance_amount),
        'discountFeeUgx': float(discount_fee),
        'netAdvanceUgx': float(net_advance),
        'faceValueUgx': float(face_value),
    }

    return breakdown
