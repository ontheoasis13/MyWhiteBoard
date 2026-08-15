# Semantic Board schema

A board is a versioned entity with `id`, `title`, `boardType`, `version`, timestamps, an `elements` object, and an explicit `order` array. The Semantic Board is authoritative; Excalidraw elements are projections.

Common element payload:

```json
{
  "id": "auth-service",
  "kind": "node",
  "semanticType": "service",
  "label": "Auth Service",
  "properties": {
    "code": { "file": "src/auth.ts", "symbol": "authenticate" },
    "style": { "strokeColor": "#475569", "backgroundColor": "#ffffff" }
  },
  "layout": { "x": 120, "y": 160, "width": 240, "height": 110 }
}
```

Connected edge:

```json
{
  "id": "api-to-auth",
  "kind": "edge",
  "semanticType": "dependency",
  "label": "verifies token",
  "properties": {
    "sourceId": "api-service",
    "targetId": "auth-service",
    "points": [[0, 0], [180, 0]]
  },
  "layout": { "x": 360, "y": 210, "width": 180, "height": 1 }
}
```

Every stored element receives `version`, `createdAt`, and `updatedAt`. A `board_apply` update or delete must send the stored element version as `expected_version`. Create operations do not send a version.

Supported semantic kinds are `node`, `edge`, `text`, `note`, `section`, and `group`. Use `semanticType` for domain meaning such as `service`, `database`, `decision`, `task`, `artifact`, `screen`, or `relationship`.
