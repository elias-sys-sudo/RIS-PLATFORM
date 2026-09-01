/**
 * Centralized query key factories for React Query.
 * Every module follows this pattern for consistent cache invalidation.
 */

export const invoiceKeys = {
  all:      ['invoices'] as const,
  lists:    () => [...invoiceKeys.all, 'list'] as const,
  list:     (filters: Record<string, unknown>) => [...invoiceKeys.lists(), filters] as const,
  details:  () => [...invoiceKeys.all, 'detail'] as const,
  detail:   (id: string) => [...invoiceKeys.details(), id] as const,
  timeline: (id: string) => [...invoiceKeys.all, 'timeline', id] as const,
};

export const approvalKeys = {
  all:      ['approvals'] as const,
  lists:    () => [...approvalKeys.all, 'list'] as const,
  list:     (filters: Record<string, unknown>) => [...approvalKeys.lists(), filters] as const,
  details:  () => [...approvalKeys.all, 'detail'] as const,
  detail:   (id: string) => [...approvalKeys.details(), id] as const,
  history:  (filters: Record<string, unknown>) => [...approvalKeys.all, 'history', filters] as const,
};

export const paymentKeys = {
  all:      ['payments'] as const,
  pending:  () => [...paymentKeys.all, 'pending'] as const,
  details:  () => [...paymentKeys.all, 'detail'] as const,
  detail:   (id: string) => [...paymentKeys.details(), id] as const,
};

export const collectionKeys = {
  all:      ['collections'] as const,
  lists:    () => [...collectionKeys.all, 'list'] as const,
  list:     (filters: Record<string, unknown>) => [...collectionKeys.lists(), filters] as const,
  details:  () => [...collectionKeys.all, 'detail'] as const,
  detail:   (id: string) => [...collectionKeys.details(), id] as const,
};

export const dashboardKeys = {
  all:          ['dashboard'] as const,
  summary:      (period: string) => [...dashboardKeys.all, 'summary', period] as const,
  approvalQueue: () => [...dashboardKeys.all, 'approval-queue'] as const,
  fundingPipeline: () => [...dashboardKeys.all, 'funding-pipeline'] as const,
  supplier:     (period: string) => [...dashboardKeys.all, 'supplier', period] as const,
  legal:        () => [...dashboardKeys.all, 'legal'] as const,
  risk:         (period: string) => [...dashboardKeys.all, 'risk-distribution', period] as const,
};

export const supplierKeys = {
  all:      ['suppliers'] as const,
  lists:    () => [...supplierKeys.all, 'list'] as const,
  list:     (filters: Record<string, unknown>) => [...supplierKeys.lists(), filters] as const,
  details:  () => [...supplierKeys.all, 'detail'] as const,
  detail:   (id: string) => [...supplierKeys.details(), id] as const,
};

export const buyerKeys = {
  all:      ['buyers'] as const,
  lists:    () => [...buyerKeys.all, 'list'] as const,
  details:  () => [...buyerKeys.all, 'detail'] as const,
  detail:   (id: string) => [...buyerKeys.details(), id] as const,
};

export const buyerRequestKeys = {
  all:    ['buyer-requests'] as const,
  mine:   () => [...buyerRequestKeys.all, 'mine'] as const,
  lists:  () => [...buyerRequestKeys.all, 'list'] as const,
  list:   (status?: string) => [...buyerRequestKeys.lists(), { status }] as const,
};

export const facilityKeys = {
  all:      ['facilities'] as const,
  lists:    () => [...facilityKeys.all, 'list'] as const,
  details:  () => [...facilityKeys.all, 'detail'] as const,
  detail:   (id: string) => [...facilityKeys.details(), id] as const,
};

export const reportKeys = {
  all:      ['reports'] as const,
  report:   (type: string, filters: Record<string, unknown>) => [...reportKeys.all, type, filters] as const,
};

export const verificationKeys = {
  all:    ['verification'] as const,
  detail: (token: string) => [...verificationKeys.all, token] as const,
};

export const adminKeys = {
  users:      (page: number) => ['admin', 'users', page] as const,
  riskConfig: () => ['admin', 'risk-config'] as const,
};
