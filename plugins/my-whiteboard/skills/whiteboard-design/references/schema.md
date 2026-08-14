# Board schema

Each board is a JSON object with `id`, `title`, `width`, `height`, timestamps, and `elements`.

Common element fields:

```json
{
  "id": "message-field",
  "type": "rectangle",
  "x": 120,
  "y": 220,
  "width": 420,
  "height": 96,
  "text": "How can we help?",
  "style": {
    "fill": "#ffffff",
    "stroke": "#cbd5e1",
    "strokeWidth": 2,
    "color": "#334155",
    "fontSize": 16,
    "radius": 10
  }
}
```

For `arrow` and `line`, use `points` relative to `x` and `y`:

```json
{
  "id": "step-a-to-b",
  "type": "arrow",
  "x": 300,
  "y": 180,
  "points": [[0, 0], [160, 80]],
  "text": "next",
  "style": {"stroke": "#64748b", "strokeWidth": 2}
}
```

Allowed style fields are `fill`, `stroke`, `strokeWidth`, `color`, `fontSize`, `fontFamily`, `radius`, `opacity`, `textAlign`, and `fontWeight`.

Use `groupId` to bind elements for grouped selection and movement. For connected `arrow` or `line` elements, optionally set `sourceId` and `targetId`; the editor and exporters keep the connector centered on those elements as they move.
