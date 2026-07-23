import { mkdtemp, mkdir, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RepositoryInvestigation } from '../../src/investigation/repository-investigation';
import { createGitRepository, git } from '../helpers/git-repository';

describe('Repository Investigation', () => {
  it('imports each Commit reachable from multiple local refs once by SHA', async () => {
    const repositoryPath = await createGitRepository();
    const sha = await git(repositoryPath, ['rev-parse', 'HEAD']);
    await git(repositoryPath, ['branch', 'remembered-work']);
    await git(repositoryPath, ['tag', 'first-memory']);
    const applicationDataPath = await mkdtemp(join(tmpdir(), 'code-time-machine-data-'));
    const codexArtifactsPath = await mkdtemp(join(tmpdir(), 'code-time-machine-codex-'));
    const investigation = new RepositoryInvestigation({ applicationDataPath, codexArtifactsPath });

    const repository = await investigation.selectRepository(repositoryPath);
    const result = await investigation.refresh();
    const timeline = await investigation.queryTimeline();

    expect(repository.identity).not.toContain(repositoryPath);
    expect(result).toMatchObject({ added: 1, failed: 0 });
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      type: 'commit',
      id: sha,
      summary: 'feat: remember the first change',
      branches: ['main', 'remembered-work'],
      tags: ['first-memory'],
    });
  });

  it('imports only matching Codex Agent Sessions and loads their nested events on demand', async () => {
    const repositoryPath = await createGitRepository();
    const applicationDataPath = await mkdtemp(join(tmpdir(), 'code-time-machine-data-'));
    const codexArtifactsPath = await mkdtemp(join(tmpdir(), 'code-time-machine-codex-'));
    const nestedPath = join(codexArtifactsPath, '2026', '07', '23');
    await mkdir(nestedPath, { recursive: true });
    const matchingArtifact = join(nestedPath, 'matching.jsonl');
    await writeFile(
      matchingArtifact,
      [
        JSON.stringify({
          timestamp: '2026-07-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'matching-session', cwd: repositoryPath },
        }),
        '{"timestamp":"2026-07-23T10:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"Remember this repository"}}',
      ].join('\n'),
    );
    await writeFile(
      join(nestedPath, 'unrelated.jsonl'),
      [
        '{"timestamp":"2026-07-23T11:00:00.000Z","type":"session_meta","payload":{"id":"unrelated","cwd":"/unrelated/repository"}}',
        '{"timestamp":"2026-07-23T11:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"Ignore me"}}',
      ].join('\n'),
    );
    const investigation = new RepositoryInvestigation({
      applicationDataPath,
      codexArtifactsPath,
    });

    await investigation.selectRepository(repositoryPath);
    const result = await investigation.refresh();
    const timeline = await investigation.queryTimeline();
    const session = await investigation.loadAgentSession('codex:matching-session');

    expect(result).toMatchObject({ added: 2, failed: 0 });
    expect(timeline.map((entry) => entry.type)).toEqual(['commit', 'session']);
    expect(timeline.filter((entry) => entry.type === 'session')).toEqual([
      expect.objectContaining({
        id: 'codex:matching-session',
        observedAt: '2026-07-23T10:00:00.000Z',
        eventCount: 1,
      }),
    ]);
    expect(session.events).toEqual([
      expect.objectContaining({ kind: 'prompt', content: 'Remember this repository' }),
    ]);

    const movedDirectory = join(codexArtifactsPath, 'moved');
    await mkdir(movedDirectory);
    await rename(matchingArtifact, join(movedDirectory, 'renamed.jsonl'));
    const repeated = await investigation.refresh();
    expect(repeated).toMatchObject({ added: 0, skipped: 2 });
  });
});
