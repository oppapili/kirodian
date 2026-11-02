import type {
  AgentSkillDocument,
  AgentSkillInput,
  AgentSkillListResult,
  AgentSkillRepairDraft,
} from '@/features/agent-skills/AgentSkill';
import type { AgentSkillRepository, SkillFrontmatterPolicy } from '@/features/agent-skills/AgentSkillRepository';

export interface AgentSkillMutationResult<T> {
  value: T;
  refreshFailed: boolean;
}

export type AgentSkillsChangedCallback = () => void | Promise<void>;

/**
 * Manages one skills folder. Every successful mutation invalidates provider
 * skill resources so the active provider re-reads the folder.
 */
export class AgentSkillManagementCoordinator {
  constructor(
    private readonly repository: AgentSkillRepository,
    private readonly notifyAgentSkillsChanged: AgentSkillsChangedCallback,
  ) {}

  get root(): string {
    return this.repository.root;
  }

  get frontmatterPolicy(): SkillFrontmatterPolicy {
    return this.repository.frontmatterPolicy;
  }

  list(): Promise<AgentSkillListResult> {
    return this.repository.list();
  }

  async create(input: AgentSkillInput): Promise<AgentSkillMutationResult<AgentSkillDocument>> {
    const value = await this.repository.create(input);
    return this.#completeMutation(value);
  }

  async update(
    previousName: string,
    expectedRevision: string,
    input: AgentSkillInput,
  ): Promise<AgentSkillMutationResult<AgentSkillDocument>> {
    const value = await this.repository.update(previousName, expectedRevision, input);
    return this.#completeMutation(value);
  }

  async trash(
    name: string,
    expectedRevision: string,
  ): Promise<AgentSkillMutationResult<void>> {
    await this.repository.trash(name, expectedRevision);
    return this.#completeMutation(undefined);
  }

  readForRepair(name: string): Promise<AgentSkillRepairDraft> {
    return this.repository.readForRepair(name);
  }

  async repair(
    name: string,
    expectedRevision: string,
    input: AgentSkillInput,
  ): Promise<AgentSkillMutationResult<AgentSkillDocument>> {
    const value = await this.repository.repair(name, expectedRevision, input);
    return this.#completeMutation(value);
  }

  async trashBroken(name: string): Promise<AgentSkillMutationResult<void>> {
    await this.repository.trashBroken(name);
    return this.#completeMutation(undefined);
  }

  async #completeMutation<T>(value: T): Promise<AgentSkillMutationResult<T>> {
    try {
      await this.notifyAgentSkillsChanged();
      return { value, refreshFailed: false };
    } catch {
      return { value, refreshFailed: true };
    }
  }
}
