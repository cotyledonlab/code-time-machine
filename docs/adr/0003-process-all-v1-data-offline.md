# Process all v1 data offline

Code Time Machine keeps repository and agent session data on the Developer's device: v1 performs import, association, search, and display without network transmission or telemetry. Any future networked feature, including remote AI summaries, requires a new explicit architectural decision and a consent model rather than weakening this guarantee implicitly.
