import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import type { SubagentRun, SubagentRunDetail, SubagentRunDetailRequest, SubagentTranscriptEntry } from '@cindy/maker-shared/subagent-workspace';
import { Text } from '@/components/AppText';
import { SubagentAvatar } from './SubagentAvatar';
import { buildSubagentConversation, lastAssistantItemId, subagentDisplayTitle, type SubagentConversationItem } from '@cindy/maker-shared/subagent-workspace';
import { remoteSessionStore } from '@/session/remoteSessionStore';
import type { MobileMakerTransport } from '@/device-link/mobileMakerTransport';
import { useTheme, useThemedStyles, type ThemeColors } from '@/theme';
import { fontWeight, radius, spacing, typeScale } from '@/theme/tokens';

export type MobileSubagentSelection = Pick<SubagentRunDetailRequest, 'provider' | 'runIdOrAlias'>;
interface ReaderProps {
  maker: Pick<MobileMakerTransport, 'listSubagentRuns' | 'getSubagentRunDetail' | 'getSubagentTranscript'>;
  sessionId: string;
  selection: MobileSubagentSelection;
  onClose(): void;
  onQuote(text: string): void;
}

/** Mounted only while open; changing device/task remounts it at the route boundary. */
export function SubagentReader({ maker, sessionId, selection, onClose, onQuote }: ReaderProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<MobileSubagentSelection | null>(selection);
  const [runs, setRuns] = useState<SubagentRun[]>([]);
  const [detail, setDetail] = useState<SubagentRunDetail | null>(null);
  const [entries, setEntries] = useState<SubagentTranscriptEntry[]>([]);
  const [processExpanded, setProcessExpanded] = useState<boolean | null>(null);
  const [childId, setChildId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const [more, setMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [newContent, setNewContent] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const following = useRef(true);
  const loadMoreRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const authority = remoteSessionStore.captureSessionMessageAuthority(sessionId);
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let cursor: string | undefined;
    let listCursor: string | undefined;
    setLoading(true);
    setDetail(null);
    setEntries([]);
    setRuns([]);
    setNotice(null);
    setIncomplete(false);
    setMore(false);
    setChildId(null);
    setProcessExpanded(null);
    setNewContent(false);
    following.current = true;
    const load = async (appendList = false): Promise<void> => {
      if (disposed || busy) return;
      busy = true;
      setLoading(true);
      try {
        if (!selected) {
          const input = { sessionId, ...(appendList ? { cursor: listCursor } : {}) };
          const response = await maker.listSubagentRuns(input);
          if (disposed || !remoteSessionStore.isSessionMessageAuthorityCurrent(authority)) return;
          if (!response.supported) { setNotice('unsupported'); return; }
          setRuns((current) => appendList ? [...current, ...response.runs] : response.runs);
          listCursor = response.nextCursor;
          setMore(Boolean(listCursor));
          return;
        }
        const input = { sessionId, ...selected };
        const response = await maker.getSubagentRunDetail(input);
        if (disposed || !remoteSessionStore.isSessionMessageAuthorityCurrent(authority)) return;
        setDetail(response.run);
        if (!response.supported || !response.run) {
          setEntries([]);
          setNotice(response.supported ? 'notFound' : 'unsupported');
          return;
        }
        setNotice(null);
        if (!response.run.capabilities.viewFullTranscript) { setIncomplete(true); return; }
        const request = { ...input, cursor, limit: 25 };
        const page = await maker.getSubagentTranscript(request);
        if (disposed || !remoteSessionStore.isSessionMessageAuthorityCurrent(authority)) return;
        if (!page.supported) { setEntries([]); setIncomplete(true); return; }
        setEntries((current) => {
          const pairs = current.map((entry) => [entry.id, entry] as const);
          const byId = new Map(pairs);
          for (const entry of page.entries) byId.set(entry.id, entry);
          return [...byId.values()];
        });
        if (page.entries.length && !following.current) setNewContent(true);
        setIncomplete((current) => current || page.incomplete === true);
        cursor = page.nextCursor ?? page.tailCursor;
        setMore(Boolean(page.nextCursor));
      } catch {
        if (!disposed) setNotice('loadFailed');
      } finally {
        busy = false;
        if (!disposed && remoteSessionStore.isSessionMessageAuthorityCurrent(authority)) {
          setLoading(false);
          if (timer) clearTimeout(timer);
          // One request chain, also reading after completion to catch a late native-file flush.
          if (selected) timer = setTimeout(() => {
            if (AppState.currentState === 'active') void load();
          }, 3000);
        }
      }
    };
    const activate = AppState.addEventListener('change', (state) => { if (state === 'active') void load(); });
    loadMoreRef.current = () => { void load(true); };
    void load();
    return () => { disposed = true; if (timer) clearTimeout(timer); activate.remove(); };
  }, [maker, sessionId, selected, refresh]);

  const child = detail?.children?.find((item) => item.id === childId || item.identityAliases?.includes(childId ?? ''));
  const visibleEntries = useMemo(() => {
    const ids = child ? [child.id, ...(child.identityAliases ?? [])] : null;
    return entries.filter((entry) => !ids || !entry.childId || ids.includes(entry.childId));
  }, [entries, child]);
  const conversation = useMemo(() => buildSubagentConversation(visibleEntries), [visibleEntries]);
  const result = child ? child.output : detail?.returnedResult ?? (detail?.status === 'completed' ? detail.summary : undefined);
  const status = child?.status ?? detail?.status;
  const settled = status && status !== 'running' && status !== 'queued';
  const resultAvailable = Boolean(result) && settled;
  const finalId = settled ? lastAssistantItemId(conversation.items) : null;
  const finalItem = conversation.items.find((item) => item.id === finalId);
  const finalText = resultAvailable ? result : finalItem?.kind === 'subagent' ? finalItem.content : undefined;
  const processItems = conversation.items.filter((item) => item.id !== finalId || item.kind === 'subagent' && item.content !== finalText);
  const processOpen = processExpanded ?? !settled;
  const titleSource = child ? { id: child.identityAliases?.at(-1) ?? child.id } : detail;
  const title = titleSource ? subagentDisplayTitle(titleSource) : t('session.subagents.allRuns');
  const durationMs = detail?.usage?.durationMs ?? ((detail?.endedAt ?? detail?.updatedAt ?? 0) - (detail?.startedAt ?? 0));
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  const processLabel = settled ? t('session.subagents.elapsed', { duration: `${seconds}s` }) : t(`session.subagents.status.${status ?? 'running'}`);
  const open = (run: SubagentRun) => {
    const next = { provider: run.provider, runIdOrAlias: run.id };
    setDetail(null); setEntries([]); setSelected(next);
  };
  const quote = () => { if (finalText) onQuote(finalText); };
  const copy = () => {
    if (finalText) void Clipboard.setStringAsync(finalText).then(() => setNotice('copied')).catch(() => setNotice('copyFailed'));
  };
  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.row}>
        {selected && <Pressable accessibilityRole="button" style={styles.button} onPress={() => setSelected(null)}><Text style={styles.text}>{t('session.subagents.allRuns')}</Text></Pressable>}
        {titleSource && <SubagentAvatar source={titleSource} />}
        <Text numberOfLines={1} style={[styles.title, styles.flex]}>{title}</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={onClose}><Text style={styles.text}>{t('session.subagents.close')}</Text></Pressable>
      </View>
      {notice && <Pressable accessibilityRole="button" style={styles.header} onPress={() => setRefresh((value) => value + 1)}><Text style={styles.muted}>{t(`session.subagents.${notice}`)}</Text></Pressable>}
      {loading && <ActivityIndicator color={colors.textSecondary} />}
      <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={styles.content} scrollEventThrottle={100} onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        following.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 64;
        if (following.current) setNewContent(false);
      }} onContentSizeChange={() => { if (following.current && selected) scrollRef.current?.scrollToEnd({ animated: false }); }}>
        {!selected ? <>
          {(['running', 'finished'] as const).map((group) => {
            const grouped = runs.filter((run) => group === 'running' ? run.status === 'running' : run.status !== 'running');
            return <View key={group} style={styles.section}>
              <Text style={styles.muted}>{t(`session.subagents.${group}`)} · {grouped.length}</Text>
              {group === 'running' && !grouped.length && <Text style={styles.muted}>{t('session.subagents.noRunning')}</Text>}
              {grouped.map((run) => <Pressable key={run.id} accessibilityRole="button" style={styles.runRow} onPress={() => open(run)}>
                <SubagentAvatar source={run} /><Text numberOfLines={1} style={[styles.text, styles.flex]}>{subagentDisplayTitle(run)}</Text>
                <Text style={styles.muted}>{t(`session.subagents.status.${run.status}`)}</Text>
              </Pressable>)}
            </View>;
          })}
        </> : <>
          {(detail?.children?.length ?? 0) > 1 && <View style={styles.wrap}>
            <Pressable accessibilityRole="button" style={styles.button} onPress={() => setChildId(null)}><Text style={styles.text}>{t('session.subagents.filters.all')}</Text></Pressable>
            {detail!.children!.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: child?.id === item.id }} style={[styles.button, child?.id === item.id && styles.selected]} onPress={() => setChildId(item.id)}><Text style={styles.text}>{subagentDisplayTitle({ id: item.identityAliases?.at(-1) ?? item.id })}</Text></Pressable>)}
          </View>}
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: processOpen }} style={styles.processToggle} onPress={() => setProcessExpanded(!processOpen)}>
            <Text style={styles.muted}>{processLabel} {processOpen ? '⌄' : '›'}</Text>
          </Pressable>
          {processOpen && <View style={styles.section}>
            {detail?.description && !conversation.items.some((item) => item.kind === 'parent') && <View style={styles.assignment}><Text selectable style={styles.text}>{child?.task ?? detail.description}</Text></View>}
            {processItems.map((item) => <TranscriptRow key={item.id} item={item} />)}
            {!loading && !processItems.length && !detail?.description && <Text style={styles.muted}>{t('session.subagents.empty')}</Text>}
          </View>}
          {incomplete && <Text style={styles.muted}>{t('session.subagents.partial')}</Text>}
          {finalText && <View style={styles.section}>
            <Text selectable style={styles.text}>{finalText}</Text>
            <View style={styles.row}><Pressable accessibilityRole="button" style={styles.button} onPress={copy}><Text style={styles.muted}>{t('session.subagents.copy')}</Text></Pressable><Pressable accessibilityRole="button" style={styles.button} onPress={quote}><Text style={styles.muted}>{t('session.subagents.quote')}</Text></Pressable></View>
          </View>}
        </>}
        {more && <Pressable accessibilityRole="button" disabled={loading} style={styles.button} onPress={() => loadMoreRef.current()}><Text style={styles.text}>{t('session.subagents.loadMore')}</Text></Pressable>}
      </ScrollView>
      {newContent && <Pressable accessibilityRole="button" style={styles.button} onPress={() => { following.current = true; scrollRef.current?.scrollToEnd({ animated: true }); setNewContent(false); }}><Text style={styles.text}>{t('session.subagents.latest')}</Text></Pressable>}
    </View>
  </Modal>;
}

function TranscriptRow({ item }: { item: SubagentConversationItem }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (item.kind !== 'tool') return <View style={item.kind === 'parent' ? styles.assignment : styles.section}><Text selectable style={styles.text}>{item.content}</Text></View>;
  return <View style={styles.section}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={styles.processToggle}>
      <Text numberOfLines={1} style={styles.muted}>{expanded ? '⌄' : '›'} {item.summary || item.toolName || t('session.subagents.roles.tool')}</Text>
    </Pressable>
    {expanded && <View style={styles.assignment}>
      {item.inputJson && <Text selectable style={styles.text}>{item.inputJson}</Text>}
      {item.result && <Text selectable style={styles.text}>{item.result}</Text>}
    </View>}
  </View>;
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.surface },
    flex: { flex: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    content: { padding: spacing.md, gap: spacing.md },
    header: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
    title: { fontSize: typeScale.body, color: colors.textPrimary, fontWeight: fontWeight.semibold },
    text: { fontSize: typeScale.body, color: colors.textPrimary },
    muted: { fontSize: typeScale.caption, color: colors.textTertiary },
    button: { minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: 'center', borderRadius: radius.pill },
    selected: { backgroundColor: colors.surfaceElevated },
    section: { gap: spacing.md },
    processToggle: { minHeight: 44, justifyContent: 'center' },
    runRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    assignment: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surfaceElevated, borderRadius: radius.container },
  });
}
