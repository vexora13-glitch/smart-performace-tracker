import { useCallback, useEffect, useState } from 'react';
import { api, db } from './portal';
import type { ActivityEvent, AdminNotification } from './activity';
export type Overview = {
  counts: { unread: number; summaries: number; follow_up: number; messages: number };
  events: ActivityEvent[];
  notifications: AdminNotification[];
  timezone: string;
};
export function useAdminInsights(enabled: boolean, adminId?: string) {
  const [overview, setOverview] = useState<Overview | null>(null),
    [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const result = await api('insights', { action: 'overview' });
      setOverview(result);
      setError('');
    } catch {
      setError('Activity updates are unavailable. Retry shortly.');
    }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) {
      setOverview(null);
      return;
    }
    let active = true;
    let debounce: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (active) void refresh();
      }, 250);
    };
    void refresh();
    const channel = db()
      .channel(`admin-insights-${adminId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'portal_admin_notifications' },
        update,
      )
      .subscribe();
    // Poll even when subscribed: catches missed events, another tab's read state, and follow-up edits.
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 20000);
    window.addEventListener('focus', update);
    return () => {
      active = false;
      clearTimeout(debounce);
      clearInterval(poll);
      window.removeEventListener('focus', update);
      void db().removeChannel(channel);
    };
  }, [enabled, adminId, refresh]);
  return { overview, error, refresh };
}
