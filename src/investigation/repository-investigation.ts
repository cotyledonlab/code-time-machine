import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentSessionDetail,
  CommitDetail,
  CommitTimelineEntry,
  ImportDiagnostic,
  RefreshResult,
  Repository,
  TimelineEntry,
} from '../domain';
import { compareTimestamps, parseCodexArtifact } from './codex-parser';
import { GitSource } from './git-source';

export interface RepositoryInvestigationOptions {
  applicationDataPath: string;
  codexArtifactsPath?: string;
}

export class RepositoryInvestigation {
  readonly #git = new GitSource();
  readonly #applicationDataPath: string;
  readonly #codexArtifactsPath: string;
  #repository: Repository | null = null;
  #timeline: TimelineEntry[] = [];
  #diagnostics: ImportDiagnostic[] = [];
  #sessions = new Map<string, AgentSessionDetail>();
  #sessionArtifacts = new Map<string, string>();

  constructor(options: RepositoryInvestigationOptions) {
    this.#applicationDataPath = options.applicationDataPath;
    this.#codexArtifactsPath =
      options.codexArtifactsPath ?? join(homedir(), '.codex', 'sessions');
  }

  async selectRepository(repositoryPath: string): Promise<Repository> {
    this.#repository = await this.#git.select(repositoryPath);
    return this.#repository;
  }

  async refresh(): Promise<RefreshResult> {
    const repository = this.requireRepository();
    const previousIds = new Set(this.#timeline.map((entry) => `${entry.type}:${entry.id}`));
    const [commits, artifacts] = await Promise.all([
      this.#git.commits(repository),
      discoverJsonlArtifacts(this.#codexArtifactsPath),
    ]);
    const sessions = new Map<string, AgentSessionDetail>();
    const sessionArtifacts = new Map<string, string>();
    const sessionEntries: TimelineEntry[] = [];
    const diagnostics: ImportDiagnostic[] = [];

    for (const artifactPath of artifacts) {
      const parsed = await parseCodexArtifact(artifactPath, { includeEvents: false });
      if (!parsed.session.repositoryPath) continue;
      let sourceRepository: Repository;
      try {
        sourceRepository = await this.#git.select(parsed.session.repositoryPath);
      } catch {
        continue;
      }
      if (sourceRepository.identity !== repository.identity || sessions.has(parsed.session.id)) {
        continue;
      }
      sessions.set(parsed.session.id, parsed.session);
      sessionArtifacts.set(parsed.session.id, artifactPath);
      sessionEntries.push(parsed.timelineEntry);
      diagnostics.push(...parsed.diagnostics);
    }

    this.#sessions = sessions;
    this.#sessionArtifacts = sessionArtifacts;
    this.#diagnostics = diagnostics;
    this.#timeline = [...commits, ...sessionEntries].sort(compareTimelineEntries);

    const added = this.#timeline.filter(
      (entry) => !previousIds.has(`${entry.type}:${entry.id}`),
    ).length;
    return {
      added,
      changed: 0,
      skipped: this.#timeline.length - added,
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

  async loadAgentSession(
    sessionId: string,
    options: { expandTruncatedEvents?: boolean } = {},
  ): Promise<AgentSessionDetail> {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error('The Agent Session is not in the active Projection.');
    const artifactPath = this.#sessionArtifacts.get(sessionId);
    if (!artifactPath) throw new Error('The Agent Session Source Artifact is unavailable.');
    const parsed = await parseCodexArtifact(artifactPath, {
      expandTruncatedEvents: options.expandTruncatedEvents ?? false,
    });
    return structuredClone(parsed.session);
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

async function discoverJsonlArtifacts(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw error;
  }

  const artifacts = (
    await Promise.all(
      entries
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(async (entry) => {
          const path = join(root, entry.name);
          if (entry.isDirectory()) return discoverJsonlArtifacts(path);
          return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : [];
        }),
    )
  ).flat();
  return artifacts;
}

function compareTimelineEntries(left: TimelineEntry, right: TimelineEntry): number {
  return (
    compareTimestamps(right.observedAt, left.observedAt) ||
    left.type.localeCompare(right.type) ||
    left.id.localeCompare(right.id)
  );
}
