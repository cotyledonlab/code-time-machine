export type AssociationConfidence = 'confirmed' | 'strong' | 'possible' | 'rejected';

export interface Repository {
  identity: string;
  path: string;
  commonDirectory: string;
  displayName: string;
}

export interface AssociationEvidence {
  kind: 'direct-link' | 'git-operation' | 'changed-path' | 'branch-context' | 'time-proximity' | 'correction';
  description: string;
}

export interface Association {
  commitId: string;
  sessionId: string;
  confidence: AssociationConfidence;
  evidence: AssociationEvidence[];
}

export interface CommitTimelineEntry {
  type: 'commit';
  id: string;
  summary: string;
  observedAt: string;
  authorAt: string;
  parents: string[];
  branches: string[];
  tags: string[];
}

export interface SessionTimelineEntry {
  type: 'session';
  id: string;
  title: string;
  observedAt: string;
  eventCount: number;
}

export type TimelineEntry = CommitTimelineEntry | SessionTimelineEntry;

export interface RefreshResult {
  added: number;
  changed: number;
  skipped: number;
  failed: number;
  completedAt: string;
}

export interface CommitDetail extends CommitTimelineEntry {
  diff: string;
  comparedWith: string | null;
  isTruncated: boolean;
  associations: Association[];
}

export type SessionEventKind = 'prompt' | 'response' | 'tool-call' | 'test-run' | 'file-operation';

export interface SessionEvent {
  id: string;
  kind: SessionEventKind;
  occurredAt: string;
  content: string;
  isMasked: boolean;
  isTruncated: boolean;
}

export interface AgentSessionDetail extends SessionTimelineEntry {
  repositoryPath: string;
  events: SessionEvent[];
  associations: Association[];
}

export interface ImportDiagnostic {
  id: string;
  artifact: string;
  stage: 'discovery' | 'parse' | 'validation' | 'git';
  message: string;
  retryable: boolean;
}
