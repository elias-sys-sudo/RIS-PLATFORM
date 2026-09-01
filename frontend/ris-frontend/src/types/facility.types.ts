export type FacilityStatus = 'active' | 'matured' | 'closed' | 'suspended';

export interface Facility {
  id: string;
  bankName: string;
  totalLimit: number;
  drawnAmount: number;
  availableAmount: number;
  utilisationPct: number;
  interestRate: number;
  interestAccrued: number;
  /** Outstanding drawdown principal against defaulted invoices — bank debt still owed. */
  defaultedExposure: number;
  maturityDate: string;
  status: FacilityStatus;
  createdAt: string;
}

export interface FacilityDetail extends Facility {
  drawdowns: FacilityDrawdown[];
  repayments: FacilityRepayment[];
}

export interface FacilityDrawdown {
  id: string;
  amount: number;
  invoiceRef: string;
  drawnAt: string;
}

export interface FacilityRepayment {
  id: string;
  amount: number;
  paidAt: string;
  reference: string;
}

export interface FacilitiesResponse {
  data: Facility[];
  totalCount: number;
}
