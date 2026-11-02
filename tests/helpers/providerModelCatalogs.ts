import { updateCurrentKiroCatalog } from '@/providers/kiro/settings';
import { updateKiroProviderSettings } from '@/providers/kiro/settings';
import { getCurrentKiroCatalog } from '@/providers/kiro/settings';

export const modelCatalogCases = [
  {
    id: 'kiro' as const, selected: 'kiro/sonnet',
    populate(settings: Record<string, unknown>) {
      updateCurrentKiroCatalog(settings, {
        models: [
          {
            rawId: 'sonnet',
            displayName: 'Selected label',
            description: 'Selected metadata',
            reasoningEfforts: [],
            supportsReasoning: false,
          },
          {
            rawId: 'unselected-catalog-entry',
            displayName: 'Unselected',
            description: '',
            reasoningEfforts: [],
            supportsReasoning: false,
          },
        ],
      });
      updateKiroProviderSettings(settings, { enabled: true, visibleModels: ['sonnet'] });
    },
    read: (settings: Record<string, unknown>) => getCurrentKiroCatalog(settings)?.models ?? [],
  },
];
