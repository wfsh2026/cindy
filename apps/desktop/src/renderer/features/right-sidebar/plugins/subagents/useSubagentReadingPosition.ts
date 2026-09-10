import { useLayoutEffect, useRef, useState } from 'react';
import { getDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';

const readingPositions = new Map<string, { top: number; following: boolean }>();
/** Reading state only; scoped by account generation and bounded independently of transcript data. */
export function useSubagentReadingPosition(identity: string, update: readonly unknown[]) {
  const owner = getDataOwnerGeneration();
  const key = `${owner.dataOwnerId}:${owner.generation}:${identity}`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredKey = useRef<string | null>(null);
  const following = useRef(true);
  const [hasNewContent, setHasNewContent] = useState(false);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (restoredKey.current !== key) {
      if (update.length === 0) return;
      restoredKey.current = key;
      const position = readingPositions.get(key);
      following.current = position?.following ?? true;
      element.scrollTop = following.current ? element.scrollHeight : position?.top ?? 0;
      setHasNewContent(false);
    } else if (following.current) element.scrollTop = element.scrollHeight;
    else setHasNewContent(true);
  }, [key, update]);
  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
    if (following.current) setHasNewContent(false);
    if (readingPositions.size >= 128 && !readingPositions.has(key)) readingPositions.clear();
    readingPositions.set(key, { top: element.scrollTop, following: following.current });
  };
  const jumpToLatest = () => {
    const element = scrollRef.current;
    if (!element) return;
    following.current = true;
    element.scrollTop = element.scrollHeight;
    setHasNewContent(false);
    onScroll();
  };
  return { scrollRef, onScroll, hasNewContent, jumpToLatest };
}
