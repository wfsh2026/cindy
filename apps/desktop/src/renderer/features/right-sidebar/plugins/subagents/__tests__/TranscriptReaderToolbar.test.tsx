// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';
import { useSubagentReadingPosition } from '../useSubagentReadingPosition';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

function Reader({ entries }: { entries: string[] }) {
  const reading = useSubagentReadingPosition('device:parent:child:record', entries);
  return <><div data-testid="scroll" ref={reading.scrollRef} onScroll={reading.onScroll}>{entries.join(' ')}</div>{reading.hasNewContent && <button onClick={reading.jumpToLatest}>Latest</button>}</>;
}

describe('Subagent reading position', () => {
  it('keeps a reader who scrolled up in place and restores that position on reopen', () => {
    setDataOwnerGeneration('scroll-owner', 1);
    const initial = ['first'];
    const view = render(<Reader entries={initial} />);
    const element = screen.getByTestId('scroll');
    Object.defineProperties(element, { scrollHeight: { value: 1000, configurable: true }, clientHeight: { value: 100 } });
    element.scrollTop = 200;
    fireEvent.scroll(element);
    const appended = ['first', 'second'];
    view.rerender(<Reader entries={appended} />);
    expect(element.scrollTop).toBe(200);
    expect(screen.getByText('Latest')).toBeTruthy();
    view.unmount();
    render(<Reader entries={appended} />);
    const reopened = screen.getByTestId('scroll');
    expect(reopened.scrollTop).toBe(200);
    Object.defineProperties(reopened, { scrollHeight: { value: 1200, configurable: true }, clientHeight: { value: 100 } });
    fireEvent.scroll(reopened);
    cleanup();
    setDataOwnerGeneration('different-owner', 2);
    render(<Reader entries={appended} />);
    expect(screen.getByTestId('scroll').scrollTop).toBe(0);
  });
});
