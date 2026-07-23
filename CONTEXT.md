# Code Time Machine

Code Time Machine reconstructs AI-assisted software work so a developer can understand what changed, why it changed, and which agent interaction caused it.

## Language

**Developer**:
The person investigating their own AI-assisted work in a local repository.
_Avoid_: User, operator, team member

**Timeline**:
The chronological view of imported coding activity within a selected repository, from which a Developer investigates individual commits and their associated agent interactions.
_Avoid_: Feed, history, activity log

**Timeline Entry**:
A top-level item on the Timeline representing either a Commit or an Agent Session.
_Avoid_: Event, record, item

**Import**:
A read-only reconstruction of coding activity from existing Git history and agent session artifacts. Import never intercepts agent traffic or changes the Developer's workflow.
_Avoid_: Capture, recording, instrumentation

**Local Processing**:
Processing in which repository and agent session data remains on the Developer's device, with no network transmission or telemetry.
_Avoid_: Local-first, private mode, offline-friendly

**Source Artifact**:
An authoritative Git or agent session record from which coding activity is imported.
_Avoid_: Source data, raw record, input

**Projection**:
A local, indexed representation rebuilt from Source Artifacts to support the Timeline, association, and search.
_Avoid_: Database, cache, source of truth

**Correction**:
A durable Developer-authored adjustment to reconstructed activity, such as confirming or rejecting an Association. Corrections survive Projection rebuilds.
_Avoid_: Override, edit, patch

**Masking**:
Replacing a recognized secret with a concealed representation in the Projection, UI, copy, or export while leaving its Source Artifact unchanged. Masking reduces exposure but is not guaranteed to detect every secret.
_Avoid_: Redaction, deletion, sanitization

**Agent Session**:
An imported record of interactions between a Developer and a coding agent. It is source evidence and may relate to zero, one, or multiple commits.
_Avoid_: Replay, conversation, cause

**Session Event**:
A prompt, response, tool call, test run, or file operation nested within an Agent Session rather than shown as a top-level Timeline Entry.
_Avoid_: Timeline event, entry

**Association**:
An evidence-backed relationship between a Commit and an Agent Session, carrying its basis and confidence without asserting that the session caused the commit.
_Avoid_: Causation, attribution, ownership
