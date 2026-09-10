import { useCallback, useEffect, useRef, useState } from 'react';
import { useUpdateStatus } from './useUpdateStatus';
import { shouldAutoShowOfficialNotice } from '@/lib/officialNoticePresentation';
import type { OfficialNoticeAction } from '../../shared/personalBuildInfo';

export function useOfficialUpdateNotice() {
  const { official } = useUpdateStatus();
  const [open, setOpen] = useState(false);
  const current = useRef(official);
  current.current = official;
  const openRef = useRef(false);
  const personal = window.electronAPI.personalBuildInfo;

  const act = useCallback(async (action: OfficialNoticeAction) => {
    const snapshot = current.current;
    if (!snapshot?.latestVersion) return false;
    const request = { action, scopeKey: snapshot.scopeKey, version: snapshot.latestVersion };
    const result = await window.electronAPI.officialUpdateNoticeAction(request);
    return result.accepted;
  }, []);

  const onOpen = useCallback(() => {
    openRef.current = true;
    setOpen(true);
    void act('shown').catch(() => {});
  }, [act]);
  const dismiss = useCallback(() => { openRef.current = false; setOpen(false); }, []);

  useEffect(() => {
    if (!personal) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const now = Date.now();
      const eligible = shouldAutoShowOfficialNotice(current.current, now);
      if (!openRef.current && eligible && document.visibilityState === 'visible') {
        try {
          const busy = await window.electronAPI.anyActivityBlockingRelaunch({ silent: true });
          if (!busy && !cancelled && !openRef.current) {
            const accepted = await act('shown');
            if (accepted && !cancelled) { openRef.current = true; setOpen(true); }
          }
        } catch { /* Retry later if the activity probe or persistence is unavailable. */ }
      }
      if (!cancelled) timer = setTimeout(run, 15_000);
    };
    void run();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // A successful atomic claim changes lastAutoShownVersion; don't cancel our own opening.
  }, [personal, official?.scopeKey, official?.latestVersion, official?.ignoredVersion, official?.snoozedUntil, act]);

  return { open, onOpen, dismiss, act, official };
}
