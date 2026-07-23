# Store application data outside repositories

Code Time Machine stores its databases and settings in the app's macOS Application Support directory and treats every selected repository as a strictly read-only input. It never adds repository metadata, hooks, ignore rules, or commits; the UI exposes the application storage location and can rebuild a Projection there without discarding durable Corrections.
