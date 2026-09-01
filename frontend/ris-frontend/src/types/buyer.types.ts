// ── Buyer entity (subset used in invoice creation) ────────────────────────────

export interface Buyer {
  id:               string;
  name:             string;
  industry:         string;
  creditLimit:      number;
  paymentTermsDays: number;
  contactPerson?:   string;
  contactEmail?:    string;
  contactPhone?:    string;
}

export interface BuyerListResponse {
  data:  Buyer[];
  total: number;
}
