const SUPPORTED_EXCALIDRAW_TYPES = new Set(["rectangle", "ellipse", "diamond", "arrow", "line", "text", "frame"]);

function numeric(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function layoutFor(element, index) {
  const current = element.layout || {};
  return {
    x: numeric(current.x, 80 + (index % 4) * 280),
    y: numeric(current.y, 80 + Math.floor(index / 4) * 170),
    width: Math.max(1, numeric(current.width, element.kind === "text" ? 220 : 220)),
    height: Math.max(1, numeric(current.height, element.kind === "text" ? 48 : 110)),
    angle: numeric(current.angle, 0),
    locked: Boolean(current.locked),
  };
}

function shapeFor(element) {
  if (element.kind === "edge") return element.properties?.legacyType === "line" ? "line" : "arrow";
  if (element.kind === "text") return "text";
  if (element.kind === "section") return "frame";
  if (element.semanticType === "database" || element.properties?.legacyType === "ellipse") return "ellipse";
  if (element.semanticType === "decision" || element.properties?.legacyType === "diamond") return "diamond";
  return "rectangle";
}

function effectiveStyle(element) {
  const source = element.properties?.style || {};
  const note = element.kind === "note";
  const section = element.kind === "section";
  return {
    strokeColor: String(source.strokeColor || source.stroke || (section ? "#7c3aed" : "#475569")),
    backgroundColor: String(source.backgroundColor || source.fill || (note ? "#fff7cc" : section ? "transparent" : "#ffffff")),
    fillStyle: String(source.fillStyle || "solid"),
    strokeWidth: numeric(source.strokeWidth, 2),
    strokeStyle: String(source.strokeStyle || (element.kind === "group" ? "dashed" : "solid")),
    roughness: numeric(source.roughness, 1),
    opacity: numeric(source.opacity, 100),
  };
}

function metadataFor(element) {
  return {
    myWhiteboard: {
      elementId: element.id,
      version: element.version,
      kind: element.kind,
      semanticType: element.semanticType,
    },
  };
}

export function semanticBoardToExcalidrawSkeletons(board) {
  const order = Array.isArray(board?.order) ? board.order : Object.keys(board?.elements || {});
  const indexById = new Map(order.map((id, index) => [id, index]));
  return order.flatMap((id, orderIndex) => {
    const element = board.elements?.[id];
    if (!element) return [];
    const layout = layoutFor(element, orderIndex);
    const type = shapeFor(element);
    const common = {
      id: element.id,
      type,
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
      angle: layout.angle,
      locked: layout.locked,
      ...effectiveStyle(element),
      customData: metadataFor(element),
      groupIds: Array.isArray(element.properties?.groupIds) ? element.properties.groupIds : [],
    };
    if (type === "text") {
      return [{ ...common, text: element.label || "Text", fontSize: numeric(element.properties?.fontSize, 20) }];
    }
    if (type === "frame") {
      return [{ ...common, name: element.label || "Section", children: element.properties?.children || [] }];
    }
    if (type === "arrow" || type === "line") {
      const points = Array.isArray(element.properties?.points) && element.properties.points.length >= 2
        ? element.properties.points
        : [[0, 0], [Math.max(80, layout.width), 0]];
      const sourceId = element.properties?.sourceId;
      const targetId = element.properties?.targetId;
      return [{
        ...common,
        points,
        width: Math.max(1, numeric(layout.width, 160)),
        height: Math.max(1, numeric(layout.height, 1)),
        start: sourceId && indexById.has(sourceId) ? { id: sourceId } : undefined,
        end: targetId && indexById.has(targetId) ? { id: targetId } : undefined,
        label: element.label ? { text: element.label } : undefined,
      }];
    }
    return [{ ...common, label: element.label ? { text: element.label } : undefined }];
  });
}

function semanticKindForExcalidraw(element, existing) {
  if (existing?.kind) return existing.kind;
  if (element.type === "arrow" || element.type === "line") return "edge";
  if (element.type === "text") return "text";
  if (element.type === "frame") return "section";
  return "node";
}

function semanticTypeForExcalidraw(element, kind, existing) {
  if (existing?.semanticType) return existing.semanticType;
  if (kind === "edge") return "relationship";
  if (kind === "section") return "section";
  if (element.type === "ellipse") return "database";
  if (element.type === "diamond") return "decision";
  return kind === "text" ? "text" : "concept";
}

function styleFromExcalidraw(element) {
  return {
    strokeColor: element.strokeColor,
    backgroundColor: element.backgroundColor,
    fillStyle: element.fillStyle,
    strokeWidth: element.strokeWidth,
    strokeStyle: element.strokeStyle,
    roughness: element.roughness,
    opacity: element.opacity,
  };
}

function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function labelFor(element, labels, existing) {
  if (element.type === "text" && !element.containerId) return String(element.text || "");
  return String(labels.get(element.id)?.text ?? existing?.label ?? "");
}

function semanticIdFor(element) {
  return String(element.customData?.myWhiteboard?.elementId || element.id);
}

function semanticProjection(element, existing, labels) {
  const kind = semanticKindForExcalidraw(element, existing);
  const properties = {
    ...(existing?.properties || {}),
    style: styleFromExcalidraw(element),
    groupIds: Array.isArray(element.groupIds) ? element.groupIds : [],
  };
  if (kind === "edge") {
    properties.sourceId = element.startBinding?.elementId || existing?.properties?.sourceId || null;
    properties.targetId = element.endBinding?.elementId || existing?.properties?.targetId || null;
    properties.points = Array.isArray(element.points) ? element.points : existing?.properties?.points || [];
  }
  if (kind === "section") properties.children = Array.isArray(element.children) ? element.children : existing?.properties?.children || [];
  return {
    kind,
    semanticType: semanticTypeForExcalidraw(element, kind, existing),
    label: labelFor(element, labels, existing),
    properties,
    layout: {
      x: numeric(element.x, 0),
      y: numeric(element.y, 0),
      width: Math.max(1, numeric(element.width, 1)),
      height: Math.max(1, numeric(element.height, 1)),
      angle: numeric(element.angle, 0),
      locked: Boolean(element.locked),
    },
  };
}

function effectiveSemanticProjection(element, index) {
  const layout = layoutFor(element, index);
  return {
    kind: element.kind,
    semanticType: element.semanticType,
    label: String(element.label || ""),
    properties: {
      ...(element.properties || {}),
      style: effectiveStyle(element),
      groupIds: Array.isArray(element.properties?.groupIds) ? element.properties.groupIds : [],
    },
    layout,
  };
}

export function excalidrawSceneToSemanticChanges(board, sceneElements) {
  const elements = Array.from(sceneElements || []);
  const labels = new Map(elements.filter((element) => element.type === "text" && element.containerId).map((element) => [element.containerId, element]));
  const existing = board?.elements || {};
  const seen = new Set();
  const changes = [];
  const ignored = [];
  const order = Array.isArray(board?.order) ? board.order : Object.keys(existing);
  for (const element of elements) {
    if (element.type === "text" && element.containerId) continue;
    if (!SUPPORTED_EXCALIDRAW_TYPES.has(element.type)) {
      if (!element.isDeleted) ignored.push({ id: element.id, type: element.type, reason: "unsupported-semantic-kind" });
      continue;
    }
    const id = semanticIdFor(element);
    const current = existing[id];
    if (current) seen.add(id);
    if (element.isDeleted) {
      if (current) changes.push({ op: "delete", id, expectedVersion: current.version });
      continue;
    }
    const projection = semanticProjection(element, current, labels);
    if (!current) {
      changes.push({ op: "create", element: { id, ...projection } });
      continue;
    }
    const baseline = effectiveSemanticProjection(current, Math.max(0, order.indexOf(id)));
    if (!equal(projection, baseline)) changes.push({ op: "update", id, expectedVersion: current.version, patch: projection });
  }
  for (const [id, current] of Object.entries(existing)) {
    if (!seen.has(id) && !elements.some((element) => semanticIdFor(element) === id && element.isDeleted)) {
      changes.push({ op: "delete", id, expectedVersion: current.version });
    }
  }
  return { changes, ignored };
}
