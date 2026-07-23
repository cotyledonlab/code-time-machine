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
    const metadataOnly = await parseCodexArtifact(firstPath, { includeEvents: false });

    expect(first.session.id).toBe(moved.session.id);
    expect(metadataOnly.session.id).toBe(first.session.id);
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

  it('keeps stable provider identity and orders supported Session Events by source timestamp', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-artifact-current-'));
    const artifactPath = join(directory, 'current.jsonl');
    await writeFile(
      artifactPath,
      [
        '{"timestamp":"2026-07-23T11:00:00+01:00","type":"session_meta","payload":{"id":"session-123","cwd":"/project/code-time-machine","git":{"commit_hash":"starting-only"}}}',
        '{"timestamp":"2026-07-23T11:00:04+01:00","type":"response_item","payload":{"type":"function_call","name":"apply_patch","arguments":"update README.md"}}',
        '{"timestamp":"2026-07-23T11:00:02+01:00","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"npm test"}}',
        '{"timestamp":"2026-07-23T11:00:01+01:00","type":"event_msg","payload":{"type":"user_message","message":"Build it"}}',
        '{"timestamp":"2026-07-23T10:30:00+00:00","type":"event_msg","payload":{"type":"user_message","message":"Later in absolute time"}}',
        '{"timestamp":"2026-07-23T11:00:03+01:00","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"git status"}}',
        '{"timestamp":"2026-07-23T11:00:05+01:00","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Done"}]}}',
        '{"timestamp":"2026-07-23T11:00:06+01:00","type":"event_msg","payload":{"type":"agent_message","message":"Also done"}}',
      ].join('\n'),
    );

    const parsed = await parseCodexArtifact(artifactPath);

    expect(parsed.session.id).toBe('codex:session-123');
    expect(parsed.session.observedAt).toBe('2026-07-23T11:00:00+01:00');
    expect(parsed.session.events.map((event) => event.kind)).toEqual([
      'prompt',
      'test-run',
      'tool-call',
      'file-operation',
      'response',
      'response',
      'prompt',
    ]);
    expect(parsed.session.events.map((event) => event.occurredAt)).toEqual([
      '2026-07-23T11:00:01+01:00',
      '2026-07-23T11:00:02+01:00',
      '2026-07-23T11:00:03+01:00',
      '2026-07-23T11:00:04+01:00',
      '2026-07-23T11:00:05+01:00',
      '2026-07-23T11:00:06+01:00',
      '2026-07-23T10:30:00+00:00',
    ]);
    expect(JSON.stringify(parsed.session)).not.toContain('starting-only');
  });

  it('marks large Session Events as visibly Truncated', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-artifact-large-'));
    const artifactPath = join(directory, 'large.jsonl');
    await writeFile(
      artifactPath,
      [
        '{"timestamp":"2026-07-23T10:00:00.000Z","type":"session_meta","payload":{"id":"large","cwd":"/project"}}',
        JSON.stringify({
          timestamp: '2026-07-23T10:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'x'.repeat(20_000) },
        }),
      ].join('\n'),
    );

    const parsed = await parseCodexArtifact(artifactPath);
    const expanded = await parseCodexArtifact(artifactPath, { expandTruncatedEvents: true });

    expect(parsed.session.events[0]).toMatchObject({ isTruncated: true });
    expect(parsed.session.events[0]?.content).toContain('[TRUNCATED]');
    expect(expanded.session.events[0]).toMatchObject({
      isTruncated: false,
      content: 'x'.repeat(20_000),
    });
  });
});
