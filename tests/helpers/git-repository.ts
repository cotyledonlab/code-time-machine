import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function createGitRepository(): Promise<string> {
  const repositoryPath = await mkdtemp(join(tmpdir(), 'code-time-machine-git-'));

  await git(repositoryPath, ['init', '--initial-branch=main']);
  await git(repositoryPath, ['config', 'user.name', 'Test Developer']);
  await git(repositoryPath, ['config', 'user.email', 'developer@example.com']);
  await writeFile(join(repositoryPath, 'README.md'), '# A remembered project\n');
  await git(repositoryPath, ['add', 'README.md']);
  await git(repositoryPath, [
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'feat: remember the first change',
  ]);

  return repositoryPath;
}

export async function git(repositoryPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8',
  });
  return stdout.trim();
}
