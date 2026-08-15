# ADR 0001: Semantic Board State is the sole authority

Status: accepted

## Decision

Persist only My Whiteboard Semantic Board State as the authoritative board document. Excalidraw scene elements are a runtime projection. Legacy SVG/DOM files are import and rollback assets only.

User changes in Excalidraw are diffed and converted to semantic transactions before they are persisted. The system will not maintain three live, bidirectionally synchronized board models.

## Consequences

- Agent tools operate on semantic entities instead of Excalidraw JSON.
- Features unsupported by the semantic schema cannot silently become durable state.
- Adapter correctness and migration fixtures are release-critical.
- Legacy rendering can be removed after migration confidence is established without changing stored data.

