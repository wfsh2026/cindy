// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __resetComposerModePreferenceForTest,
  getComposerModePreference,
  setComposerModePreference,
} from '../useComposerModePreference';

const storageKey = 'cartethyia.composerMode.v1';

function installPlatform(platform: string): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { platform },
  });
}

describe('composer mode preference', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetComposerModePreferenceForTest();
    installPlatform('win32');
  });

  afterEach(() => {
    __resetComposerModePreferenceForTest();
    localStorage.clear();
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('Windows 个人包默认启用战斗模式，且不保存默认快照', () => {
    expect(getComposerModePreference()).toBe('cartethyia-battle');
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('关闭时保存 standard override，再启用时删除 override', () => {
    setComposerModePreference('standard');
    expect(getComposerModePreference()).toBe('standard');
    expect(localStorage.getItem(storageKey)).toBe('standard');

    setComposerModePreference('cartethyia-battle');
    expect(getComposerModePreference()).toBe('cartethyia-battle');
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('非 Windows 默认保持标准输入模式', () => {
    __resetComposerModePreferenceForTest();
    installPlatform('darwin');

    expect(getComposerModePreference()).toBe('standard');
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});
