# Use Electron, React, and TypeScript

Code Time Machine uses Electron, React, and TypeScript so its desktop shell, import pipeline, domain logic, interface, and tests can evolve in one language. Filesystem, Git, Codex parsing, masking, and persistence remain in Electron's privileged main process; the context-isolated renderer receives only narrow, typed operations through a preload bridge, rather than Node.js access or generic IPC.
