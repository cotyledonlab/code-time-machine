import { mkdtemp } from 'node:fs/promises';
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
    const investigation = new RepositoryInvestigation({ applicationDataPath });

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
});
