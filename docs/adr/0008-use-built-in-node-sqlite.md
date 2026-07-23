# Use built-in Node SQLite

Code Time Machine stores its Projection and durable Corrections in SQLite through Electron's built-in `node:sqlite` API, behind a private persistence interface and explicit versioned SQL migrations. Although the API is still release-candidate, isolating it is preferable to introducing a native SQLite addon with Electron ABI rebuild and packaging complexity; the interface preserves a migration path if the risk materializes.
