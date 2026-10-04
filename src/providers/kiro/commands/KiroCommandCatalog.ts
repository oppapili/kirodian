import type { ProviderCommandEntry } from '@/core/providers/commands/ProviderCommandEntry';
import { RuntimeCommandCatalog } from '@/core/providers/commands/RuntimeCommandCatalog';
import type { SlashCommand } from '@/core/types';

function slashCommandToEntry(command: SlashCommand): ProviderCommandEntry {
  // Kiro advertises both built-in slash commands and agent skills over the same
  // `_kiro.dev/commands/available` notification; the parser tags skills with
  // `kind: 'skill'`. Skills are shown with a `$` prefix in the dropdown but are
  // excited on the wire with `/<skillname>`, so they insert with `/`.
  const isSkill = command.kind === 'skill';
  return {
    id: command.id,
    providerId: 'kiro',
    kind: isSkill ? 'skill' : 'command',
    name: command.name,
    description: command.description,
    content: command.content,
    argumentHint: command.argumentHint,
    allowedTools: command.allowedTools,
    model: command.model,
    disableModelInvocation: command.disableModelInvocation,
    userInvocable: command.userInvocable,
    context: command.context,
    agent: command.agent,
    hooks: command.hooks,
    scope: 'runtime',
    source: command.source ?? 'sdk',
    isEditable: false,
    isDeletable: false,
    displayPrefix: isSkill ? '$' : '/',
    insertPrefix: '/',
  };
}

export class KiroCommandCatalog extends RuntimeCommandCatalog {
  constructor() {
    super({
      dropdownConfig: {
        builtInPrefix: '/',
        commandPrefix: '/',
        providerId: 'kiro',
        skillPrefix: '$',
        triggerChars: ['/', '$'],
      },
      projectEntry: slashCommandToEntry,
    });
  }
}
