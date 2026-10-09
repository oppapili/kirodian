import { getClaudeProviderSettings, updateClaudeProviderSettings } from '@/providers/claude/settings';
export const modelCatalogCases = [
  {
    id: 'claude' as const, selected: 'sonnet',
    populate(settings: Record<string, unknown>) {
      updateClaudeProviderSettings(settings, { enabled: true, visibleModels: ['sonnet'], discoveredModels: [
        { value: 'sonnet', label: 'Selected label', description: 'Selected metadata' },
        { value: 'unselected-catalog-entry', label: 'Unselected', description: '' },
      ] });
    },
    read: (settings: Record<string, unknown>) => getClaudeProviderSettings(settings).discoveredModels,
  },
];
