from decimal import Decimal
from typing import Dict, Any, Tuple

def evaluate_invoice_risk(invoice) -> Tuple[int, str, Dict[str, Any]]:
    """
    Computes 5-Factor Institutional Risk Evaluation for an Invoice.
    Returns (composite_score 0-100, risk_grade, factors_dict)
    """
    buyer = invoice.buyer
    supplier = invoice.supplier
    tenor_days = invoice.calculate_tenor_days()

    # 1. Buyer Credit Rating Score (35% weight)
    rating_scores = {
        'AAA': 95, 'AA': 90, 'A': 82, 'BBB': 72, 'BB': 58, 'B': 42, 'CCC': 25
    }
    buyer_score = rating_scores.get(buyer.credit_rating, 75)

    # 2. Tenor / Maturity Horizon Score (20% weight)
    if tenor_days <= 30:
        tenor_score = 95
    elif tenor_days <= 60:
        tenor_score = 85
    elif tenor_days <= 90:
        tenor_score = 70
    else:
        tenor_score = 50

    # 3. Supplier Track Record Score (20% weight)
    if supplier.total_invoices >= 10:
        track_score = 92
    elif supplier.total_invoices >= 5:
        track_score = 82
    elif supplier.total_invoices >= 1:
        track_score = 72
    else:
        track_score = 65

    # 4. Obligor Concentration Risk Score (15% weight)
    # Ratio of invoice face value to buyer's total credit limit
    if buyer.credit_limit > Decimal('0'):
        concentration_ratio = float(invoice.face_value_ugx / buyer.credit_limit)
        if concentration_ratio <= 0.10:
            concentration_score = 95
        elif concentration_ratio <= 0.25:
            concentration_score = 85
        elif concentration_ratio <= 0.50:
            concentration_score = 70
        else:
            concentration_score = 55
    else:
        concentration_score = 60

    # 5. Collateral / Recourse Score (10% weight)
    collateral_score = 85 if invoice.notice_of_assignment_signed else 75

    # Weighted Composite Calculation
    composite = (
        (buyer_score * 0.35) +
        (tenor_score * 0.20) +
        (track_score * 0.20) +
        (concentration_score * 0.15) +
        (collateral_score * 0.10)
    )
    final_score = int(round(composite))

    if final_score >= 80:
        risk_grade = 'low'
    elif final_score >= 65:
        risk_grade = 'medium'
    elif final_score >= 50:
        risk_grade = 'high'
    else:
        risk_grade = 'critical'

    factors = {
        'buyerRatingScore': buyer_score,
        'buyerRating': buyer.credit_rating,
        'tenorScore': tenor_score,
        'tenorDays': tenor_days,
        'supplierTrackScore': track_score,
        'supplierInvoicesCount': supplier.total_invoices,
        'concentrationScore': concentration_score,
        'collateralScore': collateral_score,
        'compositeScore': final_score,
        'riskGrade': risk_grade,
    }

    return final_score, risk_grade, factors
