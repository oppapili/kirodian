import type { App, EventRef } from 'obsidian';
import { Notice, TFile } from 'obsidian';

import { BRAND_NAME } from '../../i18n/constants';
import { formatComposerWikilink } from './composer/composerWikilinks';

interface FileMenuViewHost {
  appendToActiveInput(text: string): boolean;
}

export interface FileMenuHost {
  readonly app: App;
  activateView(): Promise<void>;
  getView(): FileMenuViewHost | null;
  registerEvent(eventRef: EventRef): void;
}

export async function addFileToClaudian(host: FileMenuHost, file: TFile): Promise<boolean> {
  try {
    await host.activateView();
    const appended = host.getView()?.appendToActiveInput(formatComposerWikilink(file.path)) ?? false;
    if (!appended) {
      new Notice(`${BRAND_NAME} chat is not ready.`);
    }
    return appended;
  } catch {
    new Notice(`Failed to add file to ${BRAND_NAME}.`);
    return false;
  }
}

export function registerFileMenu(host: FileMenuHost): void {
  host.registerEvent(
    host.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile)) return;

      menu.addItem((item) => item
        .setTitle(`Add to ${BRAND_NAME}`)
        .setIcon('message-square-plus')
        .onClick(() => addFileToClaudian(host, file)));
    }),
  );
}
