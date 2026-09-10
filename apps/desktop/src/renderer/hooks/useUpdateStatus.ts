import { useEffect, useState } from 'react';

/**
 * useUpdateStatus — listens to the main-process `update-status` IPC channel
 * and exposes the current update state to the renderer.
 *
 * On mount, queries the current status from main process to catch any status
 * set before this hook subscribed (e.g. update downloaded during splash).
 * Only the `ready` status (with a version string) triggers the UpdateBanner.
 */
export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatusPayload['status']>('idle');
  const [version, setVersion] = useState<string | undefined>();
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const [official, setOfficial] = useState<UpdateStatusPayload['official']>();
  // 下载进度（0-100）。只有 downloading/superseding 的推送带它；invoke 的初始
  // 快照不含 progress，错过的进度由下一条推送补上即可。
  const [progress, setProgress] = useState<number | undefined>();

  useEffect(() => {
    let live = true;
    let receivedPush = false;
    // Query initial status — catches 'ready' set before this hook mounted
    window.electronAPI.getUpdateStatus().then((initial) => {
      if (!live || receivedPush) return;
      if (initial && typeof initial.status === 'string') {
        setStatus(initial.status as UpdateStatusPayload['status']);
        if (initial.version) setVersion(initial.version);
        setErrorCode(initial.errorCode);
        setOfficial(initial.official);
      }
    }).catch(() => {});

    // Subscribe to future status changes
    const unsubscribe = window.electronAPI.onUpdateStatus((payload) => {
      receivedPush = true;
      if (payload && typeof payload.status === 'string') {
        setStatus(payload.status);
        if (payload.version) {
          setVersion(payload.version);
        }
        setErrorCode(payload.errorCode);
        setOfficial(payload.official);
        setProgress(typeof payload.progress === 'number' ? payload.progress : undefined);
      }
    });

    return () => { live = false; unsubscribe(); };
  }, []);

  return { status, version, errorCode, progress, official };
}
