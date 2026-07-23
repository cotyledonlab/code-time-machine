import type {
  AgentSessionDetail,
  CommitDetail,
  CommitTimelineEntry,
  ImportDiagnostic,
  RefreshResult,
  Repository,
  TimelineEntry,
} from '../domain';
import { GitSource } from './git-source';

export interface RepositoryInvestigationOptions {
  applicationDataPath: string;
}

export class RepositoryInvestigation {
  readonly #git = new GitSource();
  readonly #applicationDataPath: string;
  #repository: Repository | null = null;
  #timeline: TimelineEntry[] = [];
  #diagnostics: ImportDiagnostic[] = [];

  constructor(options: RepositoryInvestigationOptions) {
    this.#applicationDataPath = options.applicationDataPath;
  }

  async selectRepository(repositoryPath: string): Promise<Repository> {
    this.#repository = await this.#git.select(repositoryPath);
    return this.#repository;
  }

  async refresh(): Promise<RefreshResult> {
    const repository = this.requireRepository();
    const previousIds = new Set(this.#timeline.map((entry) => `${entry.type}:${entry.id}`));
    const commits = await this.#git.commits(repository);
    this.#timeline = commits.sort(compareTimelineEntries);

    const added = commits.filter((commit) => !previousIds.has(`commit:${commit.id}`)).length;
    return {
      added,
      changed: 0,
      skipped: commits.length - added,
      failed: this.#diagnostics.length,
      completedAt: new Date().toISOString(),
    };
  }

  async queryTimeline(): Promise<TimelineEntry[]> {
    return structuredClone(this.#timeline);
  }

  async loadCommit(sha: string, parent?: string): Promise<CommitDetail> {
    const repository = this.requireRepository();
    const entry = this.#timeline.find(
      (candidate): candidate is CommitTimelineEntry =>
        candidate.type === 'commit' && candidate.id === sha,
    );
    if (!entry) throw new Error(`Commit ${sha} is not in the active Projection.`);
    const { diff, comparedWith } = await this.#git.diff(repository.path, sha, parent);
    return { ...entry, diff, comparedWith, isTruncated: false, associations: [] };
  }

  async loadAgentSession(_sessionId: string): Promise<AgentSessionDetail> {
    throw new Error('The Agent Session is not in the active Projection.');
  }

  async diagnostics(): Promise<ImportDiagnostic[]> {
    return structuredClone(this.#diagnostics);
  }

  get applicationDataPath(): string {
    return this.#applicationDataPath;
  }

  private requireRepository(): Repository {
    if (!this.#repository) throw new Error('Select a Repository before starting Refresh.');
    return this.#repository;
  }
}

function compareTimelineEntries(left: TimelineEntry, right: TimelineEntry): number {
  return (
    right.observedAt.localeCompare(left.observedAt) ||
    left.type.localeCompare(right.type) ||
    left.id.localeCompare(right.id)
  );
}
