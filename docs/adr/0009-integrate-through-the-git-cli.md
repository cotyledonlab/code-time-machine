# Integrate through the Git CLI

Code Time Machine reads repository identity, refs, commits, and diffs by invoking the installed `git` executable with argument arrays and parsing stable plumbing or explicitly formatted output. It never interpolates commands through a shell; this preserves real Git and worktree semantics without reimplementing them in JavaScript, while unsupported or missing Git versions produce actionable diagnostics.
