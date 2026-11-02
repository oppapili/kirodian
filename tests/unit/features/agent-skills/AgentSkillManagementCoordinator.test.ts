import type { AgentSkillDocument, AgentSkillInput } from '@/features/agent-skills/AgentSkill';
import { AgentSkillManagementCoordinator } from '@/features/agent-skills/AgentSkillManagementCoordinator';
import type { AgentSkillRepository } from '@/features/agent-skills/AgentSkillRepository';
import { AgentSkillRevisionConflictError } from '@/features/agent-skills/AgentSkillRepository';

function makeSkill(name = 'shared-skill', revision = 'revision-1'): AgentSkillDocument {
  return {
    name,
    description: 'Shared description',
    instructions: 'Shared instructions',
    frontmatter: { name, description: 'Shared description' },
    directoryPath: `.agents/skills/${name}`,
    filePath: `.agents/skills/${name}/SKILL.md`,
    revision,
  };
}

function createRepository() {
  const skill = makeSkill();
  return {
    list: jest.fn().mockResolvedValue({ skills: [skill], diagnostics: [] }),
    create: jest.fn().mockResolvedValue(skill),
    update: jest.fn().mockResolvedValue({ ...skill, revision: 'revision-2' }),
    trash: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AgentSkillRepository>;
}

describe('AgentSkillManagementCoordinator', () => {
  it('persists once and then invalidates provider skill resources', async () => {
    const repository = createRepository();
    const notifyAgentSkillsChanged = jest.fn().mockResolvedValue(undefined);
    const coordinator = new AgentSkillManagementCoordinator(
      repository,
      notifyAgentSkillsChanged,
    );

    const input: AgentSkillInput = {
      name: 'shared-skill',
      description: 'Shared description',
      instructions: 'Shared instructions',
    };
    const result = await coordinator.create(input);

    expect(repository.create).toHaveBeenCalledWith(input);
    expect(notifyAgentSkillsChanged).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ value: makeSkill(), refreshFailed: false });
  });

  it('reports a failed provider invalidation without failing the mutation', async () => {
    const repository = createRepository();
    const coordinator = new AgentSkillManagementCoordinator(
      repository,
      jest.fn().mockRejectedValue(new Error('provider refresh unavailable')),
    );

    const result = await coordinator.trash('shared-skill', 'revision-1');

    expect(repository.trash).toHaveBeenCalledWith('shared-skill', 'revision-1');
    expect(result).toEqual({ value: undefined, refreshFailed: true });
  });

  it('does not invalidate providers when persistence fails', async () => {
    const repository = createRepository();
    repository.update.mockRejectedValue(new Error('stale revision'));
    const notify = jest.fn().mockResolvedValue(undefined);
    const coordinator = new AgentSkillManagementCoordinator(repository, notify);

    await expect(coordinator.update('shared-skill', 'stale', {
      name: 'shared-skill',
      description: 'Changed',
      instructions: 'Changed',
    })).rejects.toThrow('stale revision');

    expect(notify).not.toHaveBeenCalled();
  });

  it('propagates one success and one revision conflict from two mounted panels', async () => {
    const repository = createRepository();
    repository.update
      .mockResolvedValueOnce(makeSkill('shared-skill', 'revision-2'))
      .mockRejectedValueOnce(new AgentSkillRevisionConflictError('shared-skill'));
    const coordinator = new AgentSkillManagementCoordinator(
      repository,
      jest.fn().mockResolvedValue(undefined),
    );
    const input: AgentSkillInput = {
      name: 'shared-skill',
      description: 'Changed',
      instructions: 'Changed',
    };

    const outcomes = await Promise.allSettled([
      coordinator.update('shared-skill', 'revision-1', input),
      coordinator.update('shared-skill', 'revision-1', input),
    ]);

    expect(outcomes[0].status).toBe('fulfilled');
    expect(outcomes[1]).toEqual(expect.objectContaining({
      status: 'rejected',
      reason: expect.any(AgentSkillRevisionConflictError),
    }));
  });
});
