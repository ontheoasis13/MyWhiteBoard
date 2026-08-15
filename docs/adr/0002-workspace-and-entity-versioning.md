# ADR 0002: Workspace and entity versions

Status: accepted

## Decision

Use two complementary version layers:

- Workspace Version orders committed transactions, events, snapshots, and Delta Context.
- Entity Version protects individual mutable objects with optimistic concurrency.

A write to Entity A does not conflict merely because Entity B changed and advanced the Workspace Version. A write fails only when the expected version of the entity it changes is stale, an identifier collides, or a transaction invariant is violated.

## Consequences

- Every mutable entity requires an ID and version.
- Each transaction returns the new Workspace Version and changed entity versions.
- Local persistence requires an inter-process lock around read, validation, event append, and atomic replace.
- Cloud persistence must perform equivalent conditional updates or a transactional RPC.

