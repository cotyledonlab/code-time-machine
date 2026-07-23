# Code Time Machine

Code Time Machine reconstructs AI-assisted software work so a developer can understand what changed, why it changed, and which agent interaction caused it.

## Language

**Developer**:
The person investigating their own AI-assisted work in a local repository.
_Avoid_: User, operator, team member

**Timeline**:
The chronological view of imported coding activity within a selected repository, from which a Developer investigates individual commits and their associated agent interactions.
_Avoid_: Feed, history, activity log

**Import**:
A read-only reconstruction of coding activity from existing Git history and agent session artifacts. Import never intercepts agent traffic or changes the Developer's workflow.
_Avoid_: Capture, recording, instrumentation

**Agent Session**:
An imported record of interactions between a Developer and a coding agent. It is source evidence and may relate to zero, one, or multiple commits.
_Avoid_: Replay, conversation, cause

**Association**:
An evidence-backed relationship between a Commit and an Agent Session, carrying its basis and confidence without asserting that the session caused the commit.
_Avoid_: Causation, attribution, ownership
