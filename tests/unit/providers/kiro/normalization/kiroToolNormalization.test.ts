import { resolveKiroRawToolName } from '@/providers/kiro/normalization/kiroToolNormalization';

// `_meta.kiro` shapes measured on kiro-cli 3.1.0 (#103).
const V2_SUBAGENT_META = { kiro: { toolName: 'subagent' } };
const V3_SUBAGENT_META = { kiro: { kind: 'agent-subtask', agentSubtaskId: 'subtask-1' } };

describe('resolveKiroRawToolName subagent detection', () => {
  it('should name a V2 subagent from _meta.kiro.toolName instead of its title', () => {
    const resolved = resolveKiroRawToolName(undefined, { meta: V2_SUBAGENT_META, title: 'Spawning agent crew' });

    expect(resolved.rawName).toBe('subagent');
  });

  it('should name a V3 subagent from _meta.kiro.kind instead of its title', () => {
    const resolved = resolveKiroRawToolName(undefined, { kind: 'other', meta: V3_SUBAGENT_META, title: 'Sub-agent: general-task-execution' });

    expect(resolved.rawName).toBe('invoke_sub_agent');
  });

  it('should name a V3 subagent from an update that carries no title', () => {
    const resolved = resolveKiroRawToolName(undefined, { meta: V3_SUBAGENT_META });

    expect(resolved.rawName).toBe('invoke_sub_agent');
  });

  it('should keep the subagent name when a later update carries only a title', () => {
    const first = resolveKiroRawToolName(undefined, { meta: V2_SUBAGENT_META, title: 'Spawning agent crew' });

    const later = resolveKiroRawToolName(first, { title: 'Spawning agent crew' });

    expect(later.rawName).toBe('subagent');
  });

  it('should rename a tool first seen by title once its metadata identifies a subagent', () => {
    const first = resolveKiroRawToolName(undefined, { title: 'Spawning agent crew' });

    const later = resolveKiroRawToolName(first, { meta: V2_SUBAGENT_META });

    expect(later.rawName).toBe('subagent');
  });

  it.each([
    ['a V2 write', { kind: 'edit', meta: { kiro: { toolName: 'write' } }, title: 'Creating hello.txt' }, 'Creating hello.txt'],
    ['a V3 write', { kind: 'edit', meta: { kiro: { toolOrigin: 'default' } }, title: 'Write File' }, 'Write File'],
    ['a tool without metadata', { title: 'read_file' }, 'read_file'],
    ['a tool whose metadata is not a record', { meta: { kiro: 'subagent' }, title: 'Run' }, 'Run'],
  ])('should keep the title of %s', (_label, update, expected) => {
    expect(resolveKiroRawToolName(undefined, update).rawName).toBe(expected);
  });
});
