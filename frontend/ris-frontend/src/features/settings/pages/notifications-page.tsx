import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/axios';
import { parseApiError } from '@/lib/parse-api-error';
import {
  NOTIFICATION_EVENT_LABELS,
  type NotificationEventType,
  type NotificationPreferences,
} from '@/types/settings.types';

const EVENTS = Object.keys(NOTIFICATION_EVENT_LABELS) as NotificationEventType[];

export function NotificationsPage(): React.ReactElement {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient.get<NotificationPreferences>('/settings/notifications')
      .then(({ data }) => setPrefs(data))
      .catch(() => {
        // Default all to true if endpoint not available
        const defaults = {} as NotificationPreferences;
        EVENTS.forEach((e) => { defaults[e] = { email: true, sms: false }; });
        setPrefs(defaults);
      })
      .finally(() => setLoading(false));
  }, []);

  function toggle(event: NotificationEventType, channel: 'email' | 'sms'): void {
    if (!prefs) return;
    setPrefs({ ...prefs, [event]: { ...prefs[event], [channel]: !prefs[event][channel] } });
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await apiClient.put('/settings/notifications', prefs);
      toast.success('Preferences saved');
    } catch (err) { toast.error(parseApiError(err)); } finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold font-display">Notifications</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Notification Preferences</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-48 w-full" /> : prefs && (
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr_60px_60px] gap-2 pb-2 text-xs font-medium text-muted-foreground">
                <span>Event</span><span className="text-center">Email</span><span className="text-center">SMS</span>
              </div>
              {EVENTS.map((e) => (
                <div key={e} className="grid grid-cols-[1fr_60px_60px] gap-2 items-center py-2 border-t">
                  <span className="text-sm">{NOTIFICATION_EVENT_LABELS[e]}</span>
                  <div className="flex justify-center"><Switch checked={prefs[e].email} onCheckedChange={() => toggle(e, 'email')} /></div>
                  <div className="flex justify-center"><Switch checked={prefs[e].sms} onCheckedChange={() => toggle(e, 'sms')} /></div>
                </div>
              ))}
              <Button onClick={save} disabled={saving} className="mt-4">{saving && <Loader2 className="mr-2 size-4 animate-spin" />}Save Preferences</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
export default NotificationsPage;
