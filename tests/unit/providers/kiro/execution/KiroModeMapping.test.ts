import type { ProviderExecutionRequest } from '@/core/execution';
import { resolveKiroNativeMode } from '@/providers/kiro/execution/KiroExecutionSession';

// resolveKiroNativeMode only reads request.configuration.{mode,permissionMode}.
function requestWith(configuration: {
  mode?: string;
  permissionMode?: string;
}): ProviderExecutionRequest {
  return { configuration } as unknown as ProviderExecutionRequest;
}

describe('resolveKiroNativeMode', () => {
  // Sending Kiro an unknown modeId (e.g. 'default'/'plan') makes it return a
  // JSON-RPC Internal error, so the mapping onto real Kiro mode ids is a
  // load-bearing regression guard.
  it('maps an explicit plan mode to kiro_planner', () => {
    expect(resolveKiroNativeMode(requestWith({ mode: 'plan' }))).toBe('kiro_planner');
  });

  it('maps an explicit default mode to kiro_default', () => {
    expect(resolveKiroNativeMode(requestWith({ mode: 'default' }))).toBe('kiro_default');
  });

  it('maps an explicit normal mode to kiro_default', () => {
    expect(resolveKiroNativeMode(requestWith({ mode: 'normal' }))).toBe('kiro_default');
  });

  it('returns null for an unknown explicit mode', () => {
    expect(resolveKiroNativeMode(requestWith({ mode: 'guide' }))).toBeNull();
  });

  it('falls back to permissionMode plan -> kiro_planner', () => {
    expect(resolveKiroNativeMode(requestWith({ permissionMode: 'plan' }))).toBe('kiro_planner');
  });

  it('maps permissionMode normal and yolo to kiro_default', () => {
    expect(resolveKiroNativeMode(requestWith({ permissionMode: 'normal' }))).toBe('kiro_default');
    expect(resolveKiroNativeMode(requestWith({ permissionMode: 'yolo' }))).toBe('kiro_default');
  });

  it('never returns the abstract default/plan ids that Kiro rejects', () => {
    const results = [
      resolveKiroNativeMode(requestWith({ mode: 'plan' })),
      resolveKiroNativeMode(requestWith({ mode: 'default' })),
      resolveKiroNativeMode(requestWith({ permissionMode: 'yolo' })),
    ];
    for (const result of results) {
      expect(result).not.toBe('default');
      expect(result).not.toBe('plan');
    }
  });
});
