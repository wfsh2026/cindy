import type { SettingsSearchModule } from './settingsSearchTypes';

export default {
  id: 'personal-mods',
  order: 32,
  entries: [
    { id: 'personal-mods', tab: 'personal-mods', targetId: 'settings-panel-personal-mods', titleKey: 'settings.tabs.personalMods', sectionKey: 'settings.tabs.personalMods', aliases: ['Mod', 'mods'] },
  ],
} satisfies SettingsSearchModule;
