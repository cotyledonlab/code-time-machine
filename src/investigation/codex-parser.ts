import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  AgentSessionDetail,
  ImportDiagnostic,
  SessionEvent,
  SessionTimelineEntry,
} from '../domain';

const MAX_EVENT_LENGTH = 16_384;

interface CodexRecord {
  timestamp?: unknown;
  type?: unknown;
  payload?: unknown;
}

export interface ParsedCodexArtifact {
  session: AgentSessionDetail;
  timelineEntry: SessionTimelineEntry;
  diagnostics: ImportDiagnostic[];
}

export async function parseCodexArtifact(artifactPath: string): Promise<ParsedCodexArtifact> {
  const source = await readFile(artifactPath, 'utf8');
  const artifact = basename(artifactPath);
  const diagnostics: ImportDiagnostic[] = [];
  const records: CodexRecord[] = [];

  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as CodexRecord);
    } catch {
      diagnostics.push(diagnostic(artifact, 'parse', `Malformed JSONL at line ${index + 1}.`));
    }
  }

  const metadata = records.find((record) => record.type === 'session_meta');
  const metadataPayload = objectPayload(metadata?.payload);
  const repositoryPath = stringValue(metadataPayload.cwd) ?? '';
  const stableId =
    stringValue(metadataPayload.id) ??
    stringValue(metadataPayload.session_id) ??
    stringValue(metadataPayload.sessionId);
  const id = stableId
    ? `codex:${stableId}`
    : `codex:inferred:${createHash('sha256').update(source).digest('hex')}`;

  const events: SessionEvent[] = [];
  records.forEach((record, recordIndex) => {
    if (record === metadata) return;
    const event = eventFromRecord(record, id, recordIndex);
    if (event) {
      events.push(event);
      return;
    }
    diagnostics.push(
      diagnostic(
        artifact,
        'validation',
        `Unsupported Codex record type: ${String(record.type ?? 'missing')}`,
      ),
    );
  });
  events.sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id),
  );

  const observedAt =
    timestamp(metadata) ?? events[0]?.occurredAt ?? new Date(0).toISOString();
  const title =
    events.find((event) => event.kind === 'prompt')?.content.slice(0, 80) || 'Codex Agent Session';
  const timelineEntry: SessionTimelineEntry = {
    type: 'session',
    id,
    title,
    observedAt,
    eventCount: events.length,
  };

  return {
    timelineEntry,
    session: {
      ...timelineEntry,
      repositoryPath,
      events,
      associations: [],
    },
    diagnostics,
  };
}

function eventFromRecord(
  record: CodexRecord,
  sessionId: string,
  recordIndex: number,
): SessionEvent | null {
  const occurredAt = timestamp(record);
  if (!occurredAt) return null;
  const payload = objectPayload(record.payload);
  let kind: SessionEvent['kind'] | undefined;
  let content: string | undefined;

  if (record.type === 'event_msg' && payload.type === 'user_message') {
    kind = 'prompt';
    content = stringValue(payload.message);
  } else if (record.type === 'response_item' && payload.type === 'message') {
    kind = payload.role === 'user' ? 'prompt' : 'response';
    content = textContent(payload.content);
  } else if (
    record.type === 'response_item' &&
    (payload.type === 'function_call' || payload.type === 'function_call_output')
  ) {
    const name = stringValue(payload.name);
    const value = stringValue(payload.arguments) ?? stringValue(payload.output);
    kind = classifyTool(name, value);
    content = [name, value].filter(Boolean).join('\n');
  }

  if (!kind || content === undefined) return null;
  const masked = maskSecrets(content);
  const truncated = masked.length > MAX_EVENT_LENGTH;
  return {
    id: `${sessionId}:event:${recordIndex}`,
    kind,
    occurredAt,
    content: truncated ? `${masked.slice(0, MAX_EVENT_LENGTH)}\n[TRUNCATED]` : masked,
    isMasked: masked !== content,
    isTruncated: truncated,
  };
}

function classifyTool(name?: string, value?: string): SessionEvent['kind'] {
  const haystack = `${name ?? ''} ${value ?? ''}`.toLowerCase();
  if (/(?:vitest|jest|pytest|cargo test|npm test|pnpm test)/u.test(haystack)) return 'test-run';
  if (/(?:apply_patch|write_file|create_file|edit_file)/u.test(haystack)) return 'file-operation';
  return 'tool-call';
}

function textContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((part) => {
      const item = objectPayload(part);
      return stringValue(item.text) ?? stringValue(item.input_text) ?? stringValue(item.output_text);
    })
    .filter((part): part is string => part !== undefined);
  return parts.length ? parts.join('\n') : undefined;
}

function maskSecrets(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/gu, '[MASKED secret]')
    .replace(
      /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/gu,
      '[MASKED secret]',
    );
}

function timestamp(record?: CodexRecord): string | undefined {
  return typeof record?.timestamp === 'string' && !Number.isNaN(Date.parse(record.timestamp))
    ? record.timestamp
    : undefined;
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function diagnostic(
  artifact: string,
  stage: ImportDiagnostic['stage'],
  message: string,
): ImportDiagnostic {
  return {
    id: createHash('sha256').update(`${artifact}:${stage}:${message}`).digest('hex'),
    artifact,
    stage,
    message,
    retryable: false,
  };
}
