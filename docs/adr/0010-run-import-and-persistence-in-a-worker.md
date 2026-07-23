# Run import and persistence in a worker

Code Time Machine assigns Codex parsing, Git orchestration, association rules, and synchronous SQLite ownership to a dedicated Node worker owned by Electron's main process. The main thread coordinates desktop APIs and validated bridge requests without long-running work, keeping large Imports responsive while establishing explicit boundaries for progress, cancellation, recovery, and testing.
