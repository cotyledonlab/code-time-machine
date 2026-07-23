import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCodexArtifact } from '../../src/investigation/codex-parser';

describe('Codex Source Artifact parser', () => {
  it('uses a content identity, nests known events, Masks secrets, and diagnoses unknown records', async () => {
    const fixture = await readFile(
      new URL('../fixtures/codex/session-without-id.jsonl', import.meta.url),
      'utf8',
    );
    const firstDirectory = await mkdtemp(join(tmpdir(), 'codex-artifact-a-'));
    const secondDirectory = await mkdtemp(join(tmpdir(), 'codex-artifact-b-'));
    const firstPath = join(firstDirectory, 'first.jsonl');
    const movedPath = join(secondDirectory, 'moved.jsonl');
    const content = fixture.replace('__REPOSITORY_PATH__', '/project/code-time-machine');
    await Promise.all([writeFile(firstPath, content), writeFile(movedPath, content)]);

    const first = await parseCodexArtifact(firstPath);
    const moved = await parseCodexArtifact(movedPath);

    expect(first.session.id).toBe(moved.session.id);
    expect(first.session.id).toMatch(/^codex:inferred:/);
    expect(first.session.events.map((event) => event.kind)).toEqual(['prompt', 'response']);
    expect(first.session.events[0]?.content).toContain('[MASKED secret]');
    expect(first.session.events[0]?.content).not.toContain('sk-test-');
    expect(first.diagnostics).toEqual([
      expect.objectContaining({
        artifact: basename(firstPath),
        stage: 'validation',
        message: 'Unsupported Codex record type: future_record',
      }),
    ]);
  });
});
