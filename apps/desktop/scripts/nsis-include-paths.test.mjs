import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const installerUrl = new URL('../resources/installer.nsh', import.meta.url);
const directoryUrl = new URL('../resources/installer-directory.nsh', import.meta.url);
const installer = readFileSync(installerUrl, 'utf8');
const directory = readFileSync(directoryUrl, 'utf8');

describe('Windows NSIS include paths', () => {
  it('captures the include directory before header macros expand', () => {
    expect(installer).toContain('!define CINDY_INSTALLER_RESOURCES "${__FILEDIR__}"');
    expect(directory).toContain('!define CINDY_INSTALLER_RESOURCES "${__FILEDIR__}"');
    expect(installer).toContain('!include "${CINDY_INSTALLER_RESOURCES}\\winget-shortcuts.nsh"');
    expect(installer).toContain('!include "${CINDY_INSTALLER_RESOURCES}\\installer-directory.nsh"');
    expect(directory).toContain(
      '!include "${CINDY_INSTALLER_RESOURCES}\\installer-directory-messages.nsh"',
    );
  });

  it('does not depend on the NSIS working directory for project-owned files', () => {
    expect(installer).not.toContain('${BUILD_RESOURCES_DIR}');
    expect(directory).not.toContain('${BUILD_RESOURCES_DIR}');
    expect(installer).not.toContain('!include "winget-shortcuts.nsh"');
    expect(installer).not.toContain('!include "installer-directory.nsh"');
    expect(directory).not.toContain('!include "installer-directory-messages.nsh"');
  });
});
