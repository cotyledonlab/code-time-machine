# Separate Source Artifacts, Projections, and Corrections

Git and agent session Source Artifacts are the authoritative record of coding activity, while Code Time Machine stores a disposable, rebuildable Projection for timelines, associations, and search. Developer-authored Corrections are application-owned durable data and must survive Projection rebuilds, preventing parser or schema changes from either inventing history or discarding confirmed knowledge.
