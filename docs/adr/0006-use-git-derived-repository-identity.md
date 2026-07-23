# Use Git-derived Repository Identity

Code Time Machine identifies a selected repository through its resolved Git identity rather than a filesystem path or remote URL, so moved repositories and linked worktrees retain continuity. Recorded paths, remotes, and shared commit SHAs remain supporting identity evidence, avoiding a path-based key that would orphan Projections and Corrections when local repository layout changes.
