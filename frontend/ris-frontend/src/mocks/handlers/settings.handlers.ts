import { http, HttpResponse, delay } from 'msw';
import type { UserProfile } from '../../types/settings.types';
import type {
  NotificationPreferences,
  NotificationEventType,
  NotificationChannel,
} from '../../types/settings.types';

// ── Seed data ─────────────────────────────────────────────────────────────────

const profileStore: UserProfile = {
  id:    'usr_001',
  name:  'Admin User',
  email: 'admin@ris.ug',
  phone: '+256 700 001 001',
};

const EVENT_TYPES: NotificationEventType[] = [
  'invoice_submitted', 'invoice_approved', 'invoice_rejected',
  'payment_disbursed', 'payment_received', 'collection_due',
  'collection_overdue', 'approval_required', 'dual_auth_required', 'document_uploaded',
];

const CHANNELS: NotificationChannel[] = ['email', 'sms'];

let notifStore: NotificationPreferences = Object.fromEntries(
  EVENT_TYPES.map((ev) => [
    ev,
    Object.fromEntries(CHANNELS.map((ch) => [ch, ch === 'email'])),
  ]),
) as NotificationPreferences;

// ── Handlers ──────────────────────────────────────────────────────────────────

export const settingsHandlers = [

  // GET /api/settings/profile
  http.get('/api/settings/profile', async () => {
    await delay(300);
    return HttpResponse.json<UserProfile>({ ...profileStore });
  }),

  // PUT /api/settings/profile
  http.put('/api/settings/profile', async ({ request }) => {
    await delay(500);
    const body = await request.json() as Partial<UserProfile>;

    if (!body.name?.trim()) {
      return HttpResponse.json({ message: 'Name is required.' }, { status: 400 });
    }
    if (!body.email?.trim()) {
      return HttpResponse.json({ message: 'Email is required.' }, { status: 400 });
    }

    profileStore.name  = body.name  ?? profileStore.name;
    profileStore.email = body.email ?? profileStore.email;
    profileStore.phone = body.phone ?? profileStore.phone;

    return HttpResponse.json<UserProfile>({ ...profileStore });
  }),

  // GET /api/settings/notifications
  http.get('/api/settings/notifications', async () => {
    await delay(300);
    return HttpResponse.json<NotificationPreferences>({ ...notifStore });
  }),

  // PUT /api/settings/notifications
  http.put('/api/settings/notifications', async ({ request }) => {
    await delay(400);
    const body = await request.json() as NotificationPreferences;
    notifStore = { ...notifStore, ...body };
    return new HttpResponse(null, { status: 204 });
  }),

];
