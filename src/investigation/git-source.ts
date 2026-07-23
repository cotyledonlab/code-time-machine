import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { CommitTimelineEntry, Repository } from '../domain';

const execFileAsync = promisify(execFile);
const FIELD_SEPARATOR = '\u001f';

export class GitSource {
  async select(repositoryPath: string): Promise<Repository> {
    const [insideWorktree, commonDirectory, roots] = await Promise.all([
      this.run(repositoryPath, ['rev-parse', '--is-inside-work-tree']),
      this.run(repositoryPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      this.run(repositoryPath, ['rev-list', '--max-parents=0', '--all']),
    ]);

    if (insideWorktree !== 'true') {
      throw new Error('The selected folder is not a Git worktree.');
    }

    const identity = createHash('sha256')
      .update(`git-sha1:${roots.split('\n').filter(Boolean).sort().join(':')}`)
      .digest('hex');

    return {
      identity,
      path: repositoryPath,
      commonDirectory,
      displayName: basename(repositoryPath),
    };
  }

  async commits(repository: Repository): Promise<CommitTimelineEntry[]> {
    const refsText = await this.run(repository.path, [
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads',
      'refs/tags',
    ]);
    const refs = refsText.split('\n').filter(Boolean);
    if (refs.length === 0) return [];

    const shas = (await this.run(repository.path, ['rev-list', ...refs]))
      .split('\n')
      .filter(Boolean);
    const memberships = await this.memberships(repository.path, refs);

    return Promise.all(
      [...new Set(shas)].map(async (sha) => {
        const text = await this.run(repository.path, [
          'show',
          '-s',
          `--format=%H${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%P`,
          sha,
        ]);
        const [id = '', summary = '', observedAt = '', authorAt = '', parents = ''] =
          text.split(FIELD_SEPARATOR);
        const commitRefs = memberships.get(sha) ?? [];

        return {
          type: 'commit' as const,
          id,
          summary,
          observedAt,
          authorAt,
          parents: parents.split(' ').filter(Boolean),
          branches: commitRefs
            .filter((ref) => ref.startsWith('refs/heads/'))
            .map((ref) => ref.slice('refs/heads/'.length))
            .sort(),
          tags: commitRefs
            .filter((ref) => ref.startsWith('refs/tags/'))
            .map((ref) => ref.slice('refs/tags/'.length))
            .sort(),
        };
      }),
    );
  }

  async diff(repositoryPath: string, sha: string, parent?: string): Promise<{ diff: string; comparedWith: string | null }> {
    const parents = (await this.run(repositoryPath, ['show', '-s', '--format=%P', sha]))
      .split(' ')
      .filter(Boolean);
    const comparedWith = parent ?? parents[0] ?? null;
    const args = comparedWith
      ? ['diff', '--no-ext-diff', '--binary=false', comparedWith, sha]
      : ['show', '--format=', '--no-ext-diff', '--binary=false', sha];

    return { diff: await this.run(repositoryPath, args), comparedWith };
  }

  private async memberships(repositoryPath: string, refs: string[]): Promise<Map<string, string[]>> {
    const memberships = new Map<string, string[]>();
    await Promise.all(
      refs.map(async (ref) => {
        const shas = (await this.run(repositoryPath, ['rev-list', ref])).split('\n').filter(Boolean);
        for (const sha of shas) {
          const existing = memberships.get(sha) ?? [];
          existing.push(ref);
          memberships.set(sha, existing);
        }
      }),
    );
    return memberships;
  }

  private async run(repositoryPath: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['-C', repositoryPath, ...args], {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
      });
      return stdout.trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Git could not inspect the selected repository: ${message}`);
    }
  }
}
