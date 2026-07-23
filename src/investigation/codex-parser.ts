import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
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

export interface ParseCodexArtifactOptions {
  includeEvents?: boolean;
  expandTruncatedEvents?: boolean;
}

export async function parseCodexArtifact(
  artifactPath: string,
  options: ParseCodexArtifactOptions = {},
): Promise<ParsedCodexArtifact> {
  if (options.includeEvents === false) return inspectCodexArtifact(artifactPath);

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
    : `codex:inferred:${contentFingerprint(source)}`;

  const allEvents: SessionEvent[] = [];
  records.forEach((record, recordIndex) => {
    if (record === metadata) return;
    const event = eventFromRecord(record, id, recordIndex, options.expandTruncatedEvents ?? false);
    if (event) {
      allEvents.push(event);
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
  allEvents.sort(
    (left, right) =>
      compareTimestamps(left.occurredAt, right.occurredAt) || left.id.localeCompare(right.id),
  );

  const observedAt =
    timestamp(metadata) ?? allEvents[0]?.occurredAt ?? new Date(0).toISOString();
  const title =
    allEvents.find((event) => event.kind === 'prompt')?.content.slice(0, 80) ||
    'Codex Agent Session';
  const timelineEntry: SessionTimelineEntry = {
    type: 'session',
    id,
    title,
    observedAt,
    eventCount: allEvents.length,
  };

  return {
    timelineEntry,
    session: {
      ...timelineEntry,
      repositoryPath,
      events: allEvents,
      associations: [],
    },
    diagnostics,
  };
}

async function inspectCodexArtifact(artifactPath: string): Promise<ParsedCodexArtifact> {
  const artifact = basename(artifactPath);
  const fingerprint = createHash('sha256');
  const diagnostics: ImportDiagnostic[] = [];
  let metadata: CodexRecord | undefined;
  let eventCount = 0;
  let firstEventAt: string | undefined;

  const lines = createInterface({
    input: createReadStream(artifactPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    fingerprint.update(line).update('\n');
    if (!line.trim()) continue;
    const recordType = extractJsonString(line, 'type', 0);
    const payloadType = extractJsonString(line, 'type', 1);
    const recordTimestamp = extractJsonString(line, 'timestamp', 0);
    if (recordType === 'session_meta') {
      try {
        metadata = JSON.parse(line) as CodexRecord;
      } catch {
        diagnostics.push(diagnostic(artifact, 'parse', `Malformed JSONL at line ${lineNumber}.`));
      }
      continue;
    }
    if (
      isSupportedEventShape(line, recordType, payloadType) &&
      recordTimestamp &&
      !Number.isNaN(Date.parse(recordTimestamp))
    ) {
      eventCount += 1;
      if (!firstEventAt || compareTimestamps(recordTimestamp, firstEventAt) < 0) {
        firstEventAt = recordTimestamp;
      }
      continue;
    }
    if (recordType) {
      diagnostics.push(
        diagnostic(artifact, 'validation', `Unsupported Codex record type: ${recordType}`),
      );
    } else {
      diagnostics.push(diagnostic(artifact, 'parse', `Malformed JSONL at line ${lineNumber}.`));
    }
  }

  const metadataPayload = objectPayload(metadata?.payload);
  const repositoryPath = stringValue(metadataPayload.cwd) ?? '';
  const stableId =
    stringValue(metadataPayload.id) ??
    stringValue(metadataPayload.session_id) ??
    stringValue(metadataPayload.sessionId);
  const id = stableId
    ? `codex:${stableId}`
    : `codex:inferred:${fingerprint.digest('hex')}`;
  const timelineEntry: SessionTimelineEntry = {
    type: 'session',
    id,
    title: 'Codex Agent Session',
    observedAt: timestamp(metadata) ?? firstEventAt ?? new Date(0).toISOString(),
    eventCount,
  };
  return {
    timelineEntry,
    session: {
      ...timelineEntry,
      repositoryPath,
      events: [],
      associations: [],
    },
    diagnostics,
  };
}

function contentFingerprint(source: string): string {
  const normalized = source.replace(/\r\n/gu, '\n').replace(/\n?$/u, '\n');
  return createHash('sha256').update(normalized).digest('hex');
}

function extractJsonString(line: string, key: string, occurrence: number): string | undefined {
  const expression = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'gu');
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = expression.exec(line))) {
    if (index === occurrence) {
      try {
        return JSON.parse(`"${match[1]}"`) as string;
      } catch {
        return undefined;
      }
    }
    index += 1;
  }
  return undefined;
}

function isSupportedEventShape(
  line: string,
  recordType?: string,
  payloadType?: string,
): boolean {
  if (
    recordType === 'event_msg' &&
    (payloadType === 'user_message' || payloadType === 'agent_message')
  ) {
    return extractJsonString(line, 'message', 0) !== undefined;
  }
  if (recordType !== 'response_item') return false;
  if (payloadType === 'function_call' || payloadType === 'function_call_output') return true;
  if (payloadType !== 'message') return false;
  return ['content', 'text', 'input_text', 'output_text'].some(
    (key) => extractJsonString(line, key, 0) !== undefined,
  );
}

function eventFromRecord(
  record: CodexRecord,
  sessionId: string,
  recordIndex: number,
  expandTruncated: boolean,
): SessionEvent | null {
  const occurredAt = timestamp(record);
  if (!occurredAt) return null;
  const payload = objectPayload(record.payload);
  let kind: SessionEvent['kind'] | undefined;
  let content: string | undefined;

  if (record.type === 'event_msg' && payload.type === 'user_message') {
    kind = 'prompt';
    content = stringValue(payload.message);
  } else if (record.type === 'event_msg' && payload.type === 'agent_message') {
    kind = 'response';
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
  const truncated = !expandTruncated && masked.length > MAX_EVENT_LENGTH;
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

export function compareTimestamps(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right) || left.localeCompare(right);
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
