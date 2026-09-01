import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Role } from '@/lib/constants';

// ── Types ────────────────────────────────────────────────────────────────────

export type NotificationKey = 'approvals' | 'payments' | 'invoices';

interface NotificationCounts {
  approvals: number;
  payments: number;
  invoices: number;
}

interface NotificationCountsState {
  counts: NotificationCounts;
  increment: (key: NotificationKey) => void;
  clearCount: (key: NotificationKey) => void;
  clearAll: () => void;
}

// ── Role-aware key mapping ───────────────────────────────────────────────────

const ROLE_RELEVANT_KEYS: Record<Role, NotificationKey[]> = {
  supplier:           ['invoices'],
  credit_officer:     ['approvals', 'invoices'],
  finance_manager:    ['payments', 'invoices'],
  management:         ['approvals', 'payments', 'invoices'],
  compliance_officer: ['invoices'],
  auditor:            [],
  legal:              ['payments'],
};

/** Check if a notification key is relevant for the given role. */
export function isRelevantForRole(
  key: NotificationKey,
  role: Role | null,
): boolean {
  if (!role) return false;
  return ROLE_RELEVANT_KEYS[role].includes(key);
}

// ── Initial counts ───────────────────────────────────────────────────────────

const EMPTY_COUNTS: NotificationCounts = {
  approvals: 0,
  payments: 0,
  invoices: 0,
};

// ── Store ────────────────────────────────────────────────────────────────────

export const useNotificationCounts = create<NotificationCountsState>()(
  persist(
    (set) => ({
      counts: { ...EMPTY_COUNTS },

      increment: (key) =>
        set((state) => ({
          counts: {
            ...state.counts,
            [key]: state.counts[key] + 1,
          },
        })),

      clearCount: (key) =>
        set((state) => ({
          counts: { ...state.counts, [key]: 0 },
        })),

      clearAll: () => set({ counts: { ...EMPTY_COUNTS } }),
    }),
    {
      name: 'ris-notification-counts',
      storage: {
        getItem: (name) => {
          const value = sessionStorage.getItem(name);
          return value ? JSON.parse(value) as { state: NotificationCountsState } : null;
        },
        setItem: (name, value) => {
          sessionStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          sessionStorage.removeItem(name);
        },
      },
    },
  ),
);
