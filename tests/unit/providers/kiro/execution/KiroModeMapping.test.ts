import type { ProviderExecutionRequest } from '@/core/execution';
import { resolveKiroNativeMode } from '@/providers/kiro/execution/KiroExecutionSession';

// resolveKiroNativeMode only reads request.configuration.permissionMode.
// (upstream #1285 removed the separate `mode` field; permission mode is now the
// single source of the requested execution mode.)
function requestWith(configuration: {
  permissionMode?: string;
}): ProviderExecutionRequest {
  return { configuration } as unknown as ProviderExecutionRequest;
}

describe('resolveKiroNativeMode', () => {
  // Sending Kiro an unknown modeId (e.g. the abstract 'default'/'plan') makes it
  // return a JSON-RPC Internal error, so the mapping onto real Kiro mode ids is a
  // load-bearing regression guard.
  it('maps permissionMode plan to kiro_planner', () => {
    expect(resolveKiroNativeMode(requestWith({ permissionMode: 'plan' }))).toBe('kiro_planner');
  });

  it('maps permissionMode normal and yolo to kiro_default', () => {
    expect(resolveKiroNativeMode(requestWith({ permissionMode: 'normal' }))).toBe('kiro_default');
    expect(resolveKiroNativeMode(requestWith({ permissionMode: 'yolo' }))).toBe('kiro_default');
  });

  it('returns null for an unknown permissionMode', () => {
    expect(resolveKiroNativeMode(requestWith({ permissionMode: 'guide' }))).toBeNull();
  });

  it('returns null when no permissionMode is set', () => {
    expect(resolveKiroNativeMode(requestWith({}))).toBeNull();
  });

  it('never returns the abstract default/plan ids that Kiro rejects', () => {
    const results = [
      resolveKiroNativeMode(requestWith({ permissionMode: 'plan' })),
      resolveKiroNativeMode(requestWith({ permissionMode: 'normal' })),
      resolveKiroNativeMode(requestWith({ permissionMode: 'yolo' })),
      resolveKiroNativeMode(requestWith({ permissionMode: 'guide' })),
    ];
    for (const result of results) {
      expect(result).not.toBe('default');
      expect(result).not.toBe('plan');
    }
  });
});
