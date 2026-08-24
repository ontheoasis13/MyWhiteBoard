import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import {
  excalidrawSceneToSemanticChangesSince,
  semanticBoardToExcalidrawSkeletons,
} from "../../../adapters/excalidraw-adapter.mjs";

type View = "product" | "board" | "changes";
type FeatureActionability = "UNDERSTOOD" | "GROUNDED" | "ACTIONABLE";
type UnderstandingState = "READY" | "PARTIAL" | "NEEDS_INTERPRETATION" | "UNSUPPORTED" | "FAILED";
type SceneElement = Record<string, any>;

type Feature = {
  id: string;
  name: string;
  description?: string;
  rationale?: string;
  version: number;
  productState?: string;
  actionability: FeatureActionability;
  actionabilityGate?: { state: FeatureActionability; reasons?: string[] };
  groupId?: string | null;
  parentFeatureId?: string | null;
  childFeatureIds?: string[];
  groundingRefs?: string[];
  hidden?: boolean;
  humanIntent?: { corrected?: boolean; reason?: string } | null;
};

type Evidence = {
  id: string;
  type?: string;
  kind?: string;
  source?: string;
  target?: string;
  line?: number;
  certainty?: string;
  provenance?: { source?: string | null; target?: string | null };
  details?: { route?: string; observationKind?: string };
};

type ProductModel = {
  modelType: string;
  projectModelVersion: number;
  version: number;
  project: { id: string; name: string; root?: string };
  features: Record<string, Feature>;
  evidence: Record<string, Evidence>;
  humanIntent?: { featureCorrections?: Record<string, any> };
  understandingState?: UnderstandingState;
  recommendedNextAction?: string | null;
  observedFiles?: Array<{ relative: string; classification: string; sourceHash?: string }>;
  unmappedProductSignals?: Array<{ signal: string; evidenceRefs: string[]; source?: string; target?: string }>;
  repoSnapshot?: { headRevision?: string | null; dirty?: boolean; changedFiles?: string[]; capturedAt?: string | null; changedSinceBaseline?: boolean; baselineWorkingTreeFingerprint?: string | null };
  productMapProjection?: ProductMapProjection;
  visualLayout?: Record<string, { x?: number; y?: number }>;
  stats?: { features?: number; evidence?: number; confirmedEvidence?: number; possibleEvidence?: number };
};

type ProductMapGroup = { id: string; nodeKind: "group"; name: string; description?: string; featureIds: string[]; level?: number };
type ProductMapFeature = Feature & { nodeKind: "feature"; certainty?: string };
type ProductMapProjection = {
  features: ProductMapFeature[];
  hierarchy: { levels: number; roots: string[]; groups: ProductMapGroup[]; ungroupedFeatureIds?: string[] };
  visualLayout?: Record<string, { x?: number; y?: number }>;
  layoutAuthority?: string;
  repoSnapshot?: ProductModel["repoSnapshot"];
};

type ProductProposal = { id: string; status: "pending" | "confirmed" | "rejected" | "superseded"; projectId: string; basis?: "OBSERVED_EVIDENCE" | "PLANNED_INTENT"; baseRepoSnapshotId: string; proposedByAgentId: string; groups: Array<{ proposalKey: string; name: string; description?: string; memberFeatureKeys?: string[] }>; features: Array<{ proposalKey: string; name: string; description?: string; evidenceRefs: string[]; groupKey?: string | null; rationale?: string; explicitlyUngrouped?: boolean }>; version: number; provenance?: { certainty?: string; evidenceRefs?: string[] } };
type ProductResponse = { model: ProductModel; status: "READY" | "PARTIAL" | "FAILED"; understandingState?: UnderstandingState; lifecycleState?: "NEEDS_INTERPRETATION" | "PROPOSAL_PENDING" | "CONFIRMED"; recommendedNextAction?: string | null; freshness: "CURRENT" | "STALE"; productStructureStatus?: "PROPOSED" | "AWAITING_HUMAN_CONFIRMATION" | "CONFIRMED" | "REJECTED" | "STALE"; featureCount?: number; proposals?: ProductProposal[] };
type DevelopmentProjection = { status: "IN_PROGRESS" | "WAITING_FOR_USER" | "VERIFYING" | "READY_FOR_REVIEW" | "ACCEPTED" | "PAUSED"; label: string; goal: string; summary: string; lastReportedAt?: string | null; userActionRequired?: boolean; blocking?: unknown; connection?: { state: string; label: string; lastSyncAt?: string | null } };
type DevelopmentResponse = { activeChanges: Array<{ id: string; title: string; developmentProjection?: DevelopmentProjection; targetFeatureIds?: string[]; featureId?: string | null }>; recentCompletedChanges: Array<{ id: string; title: string; developmentProjection?: DevelopmentProjection }>; primaryDevelopment?: DevelopmentProjection | null; change?: { id: string; title: string; developmentProjection?: DevelopmentProjection }; workspaceVersion: number };
type SemanticElement = { id: string; kind: string; semanticType: string; label: string; version: number; properties?: Record<string, unknown>; layout?: Record<string, unknown> };
type CodeNode = SemanticElement & { properties?: { code?: { file?: string; symbol?: string; line?: number; kind?: string; language?: string; classification?: string; dependencies?: string[]; reverseDependencies?: string[] }; [key: string]: unknown } };
type Board = { id: string; title: string; boardType: string; version: number; elements: Record<string, SemanticElement>; order: string[] };
type Workspace = {
  workspaceVersion: number;
  project: { id: string; name: string; overview?: string };
  entities: {
    boards: Record<string, Board>;
    agents: Record<string, { id: string; displayName?: string; status?: string; capabilities?: string[]; lastSeenAt?: string | null; lastSyncAt?: string | null; registeredAt?: string | null; lastActivityAt?: string | null; heartbeatAt?: string | null; connectionState?: string; connectionStateSource?: string | null }>;
    tasks: Record<string, { id: string; title: string; status?: string; priority?: string; assigneeAgentId?: string | null }>;
    contexts: Record<string, { id: string; title: string; content: string; kind?: string }>;
    decisions: Record<string, { id: string; title: string; rationale: string; status?: string }>;
    artifacts: Record<string, { id: string; title: string; kind: string; path?: string | null; uri?: string | null }>;
    changes: Record<string, { id: string; title: string; status?: string; featureId?: string | null; targetFeatureIds?: string[]; development?: DevelopmentProjection }>;
    handoffs: Record<string, { id: string; title: string; summary: string; status: string; fromAgentId: string; toAgentId: string }>;
    messages: Record<string, { id: string; body: string; kind: string; fromAgentId: string; toAgentId?: string | null; channel?: string }>;
  };
};
type SessionResponse = { workspace: Workspace; activeBoardId: string | null };

function sessionHeaders() {
  const params = new URLSearchParams(location.search);
  return { "x-my-whiteboard-session": params.get("session") || "", "x-my-whiteboard-token": params.get("token") || "" };
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...sessionHeaders(), ...(init.headers || {}) } });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error?.message || "请求失败"), { code: value.error?.code, details: value.error?.details });
  return value;
}

const actionabilityLabels: Record<FeatureActionability, { title: string; description: string }> = {
  UNDERSTOOD: { title: "已识别", description: "已识别这个产品概念，还需要进一步了解它在项目中的实现。" },
  GROUNDED: { title: "已有依据", description: "已经找到相关实现，但依据可能需要重新确认。" },
  ACTIONABLE: { title: "可以规划", description: "项目关联已完成，可以开始规划修改。" },
};

function initials(value: string) {
  return value.trim().slice(0, 2).toUpperCase() || "MW";
}

function actionabilityLabel(value: string) {
  return actionabilityLabels[value as FeatureActionability]?.title || value;
}

function agentPresence(agent: { status?: string; lastSeenAt?: string | null; lastSyncAt?: string | null; connectionState?: string; connectionStateSource?: string | null }) {
  const seen = agent.lastSyncAt || agent.lastSeenAt;
  const source = String(agent.connectionStateSource || "").toUpperCase();
  const reliable = ["PROCESS_ADAPTER", "TRUSTED_HOST", "TRUSTED_ADAPTER"].includes(source) && ["CONNECTED", "DISCONNECTED"].includes(String(agent.connectionState || "").toUpperCase());
  const sync = seen ? new Date(seen).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "暂无";
  if (reliable) return `${String(agent.connectionState).toUpperCase() === "CONNECTED" ? "已连接" : "已断开"} · 最近同步：${sync}`;
  return `连接状态未知 · 最近同步：${sync}`;
}

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [product, setProduct] = useState<ProductResponse | null>(null);
  const [development, setDevelopment] = useState<DevelopmentResponse | null>(null);
  const [view, setView] = useState<View>("product");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<"feature" | "group" | "node" | null>(null);
  const [selectedNode, setSelectedNode] = useState<CodeNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [status, setStatus] = useState("正在读取项目");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState("");
  const [editingGroup, setEditingGroup] = useState("");
  const [ignored, setIgnored] = useState<Array<{ id: string; type: string }>>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(new URLSearchParams(location.search).get("board"));
  const [reloadKey, setReloadKey] = useState(0);
  const boardRef = useRef<Board | null>(null);
  const latestSceneRef = useRef<readonly SceneElement[]>([]);
  const hydratedSceneRef = useRef<readonly SceneElement[]>([]);
  const saveTimerRef = useRef<number | null>(null);
  const selectionTimerRef = useRef<number | null>(null);
  const lastSelectionRef = useRef("");
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const userInteractedRef = useRef(false);

  const refreshWorkspace = useCallback(async (resetScene = false) => {
    const result = await request<SessionResponse>("/api/session");
    setWorkspace(result.workspace);
    const boards = result.workspace.entities.boards;
    const nextBoardId = activeBoardId && boards[activeBoardId] ? activeBoardId : result.activeBoardId && boards[result.activeBoardId] ? result.activeBoardId : Object.keys(boards)[0] || null;
    setActiveBoardId(nextBoardId);
    boardRef.current = nextBoardId ? boards[nextBoardId] : null;
    if (resetScene) {
      userInteractedRef.current = false;
      hydratedSceneRef.current = [];
      lastSelectionRef.current = "";
      setReloadKey((value) => value + 1);
    }
    return result.workspace;
  }, [activeBoardId]);

  const loadProductModel = useCallback(async (scan = false) => {
    setLoading(true);
    try {
      const result = scan
        ? await request<ProductResponse>("/api/session/product-model/scan", { method: "POST", body: JSON.stringify({}) })
        : await request<ProductResponse>("/api/session/product-model");
      setProduct(result);
      setStatus(result.freshness === "STALE" ? "代码发生变化，需要重新理解实现依据" : result.lifecycleState === "PROPOSAL_PENDING" ? "产品结构等待你确认" : result.lifecycleState === "CONFIRMED" ? "产品结构已确认" : result.lifecycleState === "NEEDS_INTERPRETATION" ? "项目代码已经读取，等待 AI Agent 整理产品功能" : result.status === "PARTIAL" ? "项目已部分理解" : "项目地图已就绪");
      setError(null);
      return result;
    } catch (cause: any) {
      setError(cause.message || "无法读取项目地图");
      setStatus("项目理解失败");
      setProduct(null);
      throw cause;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDevelopment = useCallback(async () => {
    try {
      const result = await request<DevelopmentResponse>("/api/session/development");
      setDevelopment(result);
      return result;
    } catch (cause: any) {
      setDevelopment(null);
      return null;
    }
  }, []);

  useEffect(() => {
    Promise.all([refreshWorkspace(true), loadProductModel(), loadDevelopment()]).catch(() => undefined);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (selectionTimerRef.current) window.clearTimeout(selectionTimerRef.current);
    };
  }, []);

  const board = activeBoardId ? workspace?.entities.boards[activeBoardId] || null : null;
  useEffect(() => { boardRef.current = board || null; }, [board]);
  const initialElements = useMemo(() => board ? convertToExcalidrawElements(semanticBoardToExcalidrawSkeletons(board) as any, { regenerateIds: false }) : [], [board?.id, reloadKey]);

  const persistLatestScene = useCallback(async () => {
    if (savingRef.current) { dirtyRef.current = true; return; }
    const currentBoard = boardRef.current;
    if (!currentBoard) return;
    const sceneToSave = latestSceneRef.current;
    const diff = excalidrawSceneToSemanticChangesSince(currentBoard, hydratedSceneRef.current, sceneToSave);
    setIgnored(diff.ignored);
    if (!diff.changes.length) { hydratedSceneRef.current = sceneToSave; return; }
    savingRef.current = true;
    setStatus("正在保存白板语义状态");
    try {
      await request("/api/session/transaction", { method: "POST", body: JSON.stringify({ transaction: { actor: { id: "human", displayName: "用户", client: "web-workspace" }, operations: [{ type: "board.apply", boardId: currentBoard.id, changes: diff.changes }] } }) });
      await refreshWorkspace(false);
      hydratedSceneRef.current = sceneToSave;
      setError(null);
      setStatus("白板已保存");
    } catch (cause: any) {
      setError(cause.code === "VERSION_CONFLICT" ? "该元素已被其他 Agent 修改，请刷新后重试。" : cause.message);
      setStatus("保存失败");
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) { dirtyRef.current = false; window.setTimeout(() => persistLatestScene(), 0); }
    }
  }, [refreshWorkspace]);

  const persistSelection = useCallback((boardId: string, selectedElementIds: Record<string, boolean>) => {
    const elementIds = Object.keys(selectedElementIds || {}).sort();
    const signature = `${boardId}:${elementIds.join(",")}`;
    if (signature === lastSelectionRef.current) return;
    lastSelectionRef.current = signature;
    if (selectionTimerRef.current) window.clearTimeout(selectionTimerRef.current);
    selectionTimerRef.current = window.setTimeout(() => {
      request("/api/session/selection", { method: "POST", body: JSON.stringify({ boardId, elementIds }) }).catch((cause) => setError(`无法同步当前选择：${cause.message}`));
    }, 200);
  }, []);

  const onSceneChange = useCallback((elements: readonly SceneElement[], appState: { selectedElementIds?: Record<string, boolean> }) => {
    latestSceneRef.current = elements;
    const selectedSemanticId = Object.keys(appState.selectedElementIds || {})[0];
    const semantic = selectedSemanticId ? boardRef.current?.elements[selectedSemanticId] : null;
    if ((semantic?.properties as any)?.code) {
      setSelectedKind("node");
      setSelectedId(semantic?.id || null);
      setSelectedNode(semantic as CodeNode);
    } else if (selectedSemanticId) {
      setSelectedNode(null);
    }
    if (!userInteractedRef.current) { hydratedSceneRef.current = elements; return; }
    const boardId = boardRef.current?.id;
    if (boardId) persistSelection(boardId, appState.selectedElementIds || {});
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => persistLatestScene(), 500);
  }, [persistLatestScene, persistSelection]);

  const model = product?.model;
  const projection = model?.productMapProjection;
  const rawFeatures = Object.values(model?.features || {});
  const visibleFeatures = projection?.features || [];
  const groupProjection = projection?.hierarchy.groups || [];
  const featureById = useMemo(() => Object.fromEntries(rawFeatures.map((feature) => [feature.id, feature])), [model]);
  const ungroupedFeatures = (projection?.hierarchy.ungroupedFeatureIds || []).map((id) => featureById[id]).filter(Boolean);
  const groups = useMemo(() => ungroupedFeatures.length
    ? [...groupProjection, { id: "__ungrouped__", nodeKind: "group" as const, name: "未分组", description: "尚未指定产品能力的功能（仅用于展示）", featureIds: ungroupedFeatures.map((feature) => feature.id) }]
    : groupProjection, [groupProjection, ungroupedFeatures]);
  const activeDevelopment = development?.primaryDevelopment || null;
  const selectedFeature = selectedKind === "feature" && selectedId ? featureById[selectedId] || null : null;
  // Keep affordances truthful even for legacy cached bundles whose large JSX
  // line still contains the pre-hardening labels.
  useEffect(() => {
    const actionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".inspector-panel .action-stack button"));
    const evidenceButton = actionButtons.find((button) => button.textContent?.includes("了解这个功能"));
    if (evidenceButton && !evidenceButton.dataset.hardened) {
      evidenceButton.dataset.hardened = "true";
      evidenceButton.textContent = "查看依据与实现";
      evidenceButton.onclick = (event) => { event.preventDefault(); event.stopPropagation(); setShowEvidence(true); setStatus("已展开该功能的依据与实现"); };
    }
    const deepButton = actionButtons.find((button) => button.textContent?.includes("深入分析"));
    if (deepButton) deepButton.style.display = "none";
    const emptyHeading = document.querySelector<HTMLHeadingElement>(".board-canvas .empty-state h2");
    const emptyCopy = document.querySelector<HTMLParagraphElement>(".board-canvas .empty-state p");
    if (emptyHeading) emptyHeading.textContent = "尚未创建技术白板";
    if (emptyCopy) emptyCopy.textContent = "产品地图已经可以正常使用。只有当你需要查看代码架构、模块关系或自由绘图时，才需要创建技术白板。";
    const inspector = document.querySelector<HTMLElement>(".inspector-panel");
    if (inspector && selectedFeature?.rationale) {
      let rationale = inspector.querySelector<HTMLElement>("[data-product-rationale]");
      if (!rationale) { rationale = document.createElement("div"); rationale.dataset.productRationale = "true"; rationale.className = "inspector-rationale"; inspector.prepend(rationale); }
      rationale.innerHTML = `<strong>产品推断依据</strong><p></p>`;
      rationale.querySelector("p")!.textContent = selectedFeature.rationale;
    }
  }, [selectedFeature?.id, view, workspace?.workspaceVersion]);
  const selectedGroup = selectedKind === "group" && selectedId ? groups.find((group) => group.id === selectedId) || null : null;
  const groupById = useMemo(() => Object.fromEntries(groups.map((group) => [group.id, group])), [groups]);
  const selectedGroupForFeature = selectedFeature?.groupId ? groupById[selectedFeature.groupId] : null;
  const selectedNodeCode = (selectedNode?.properties as any)?.code || {};
  const nodeEvidence = useMemo(() => {
    const file = selectedNodeCode.file;
    return file ? Object.values(model?.evidence || {}).filter((item) => item.source === file || item.target === file) : [];
  }, [model, selectedNodeCode.file]);
  const nodeFeatures = useMemo(() => {
    const ids = new Set(nodeEvidence.map((item) => item.id));
    return rawFeatures.filter((feature) => (feature.groundingRefs || []).some((ref) => ids.has(ref)));
  }, [rawFeatures, nodeEvidence]);
  const matchingFeatures = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return visibleFeatures.filter((feature) => !query || `${feature.name} ${feature.description || ""}`.toLowerCase().includes(query));
  }, [visibleFeatures, searchQuery]);
  const matchingIds = useMemo(() => new Set(matchingFeatures.map((feature) => feature.id)), [matchingFeatures]);
  const focusIds = useMemo(() => {
    if (!focusMode || !selectedFeature) return null;
    return new Set([selectedFeature.id, selectedFeature.parentFeatureId, ...(selectedFeature.childFeatureIds || [])].filter(Boolean) as string[]);
  }, [focusMode, selectedFeature]);

  const selectFeature = (feature: Feature) => {
    setSelectedKind("feature");
    setSelectedNode(null);
    setSelectedId(feature.id);
    setEditingName(feature.name);
    setEditingGroup(feature.groupId || "");
    setShowEvidence(false);
  };
  const selectGroup = (group: ProductMapGroup) => {
    setSelectedKind("group");
    setSelectedNode(null);
    setSelectedId(group.id);
    setShowEvidence(false);
  };
  const chooseBoard = (id: string) => {
    setView("board");
    setSelectedNode(null);
    setActiveBoardId(id);
    boardRef.current = workspace?.entities.boards[id] || null;
    userInteractedRef.current = false;
    hydratedSceneRef.current = [];
    lastSelectionRef.current = "";
    setReloadKey((value) => value + 1);
    const url = new URL(location.href);
    url.searchParams.set("board", id);
    history.replaceState(null, "", url);
  };

  const updateProductModel = (next: ProductModel) => {
    const stale = Boolean(next.repoSnapshot?.dirty || next.repoSnapshot?.changedSinceBaseline);
    const understandingState = next.understandingState || (Object.keys(next.features || {}).length ? "READY" : "FAILED");
    setProduct({ model: next, status: understandingState === "READY" ? "READY" : understandingState === "FAILED" || understandingState === "UNSUPPORTED" ? "FAILED" : "PARTIAL", understandingState, lifecycleState: product?.lifecycleState, recommendedNextAction: next.recommendedNextAction, freshness: stale ? "STALE" : "CURRENT", proposals: product?.proposals || [] });
  };
  const correctFeature = async (patch: Record<string, unknown>, successMessage: string) => {
    if (!selectedFeature) return;
    try {
      // “未分组”是 Product Map 的展示层虚拟分组，持久化时仍表示为空 groupId。
      const normalizedPatch = patch.groupId === "__ungrouped__" ? { ...patch, groupId: null } : patch;
      const result = await request<{ model: ProductModel; feature: Feature }>("/api/session/product-feature/correct", { method: "POST", body: JSON.stringify({ feature_id: selectedFeature.id, expected_version: selectedFeature.version, patch: normalizedPatch }) });
      updateProductModel(result.model);
      setStatus(successMessage);
      setError(null);
      setEditingName(result.feature.name);
      setEditingGroup(result.feature.groupId || "");
    } catch (cause: any) { setError(cause.message); }
  };
  const revertFeature = async () => {
    if (!selectedFeature) return;
    try {
      const result = await request<{ model: ProductModel; feature: Feature }>("/api/session/product-feature/revert", { method: "POST", body: JSON.stringify({ feature_id: selectedFeature.id, expected_version: selectedFeature.version }) });
      updateProductModel(result.model);
      setStatus("已恢复自动推断");
      setError(null);
    } catch (cause: any) { setError(cause.message); }
  };
  const persistLayout = async (featureId: string, x: number, y: number) => {
    try {
      const result = await request<{ model: ProductModel }>("/api/session/product-feature/layout", { method: "POST", body: JSON.stringify({ feature_id: featureId, layout: { x, y } }) });
      updateProductModel(result.model);
      setStatus("已保存产品地图布局");
    } catch (cause: any) { setError(cause.message); }
  };
  const dropFeature = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    const featureId = event.dataTransfer.getData("text/my-whiteboard-feature");
    if (!featureId || featureId === targetId) return;
    const target = featureById[targetId];
    const layout = model?.visualLayout?.[targetId] || { x: 0, y: 0 };
    void persistLayout(featureId, Number(layout.x || 0), Number(layout.y || 0) + 18);
    setSelectedId(featureId);
    setSelectedKind("feature");
  };

  const applyProposal = async (proposal: ProductProposal, action: "confirm" | "reject") => {
    try {
      const result = await request<{ model?: ProductModel; proposal: ProductProposal }>("/api/session/product-proposal/apply", { method: "POST", body: JSON.stringify({ proposal_id: proposal.id, expected_version: proposal.version, action, actor: { id: "human", displayName: "用户", client: "product-view" } }) });
      if (result.model) updateProductModel(result.model);
      setProduct((current) => current ? { ...current, lifecycleState: action === "confirm" ? "CONFIRMED" : current.lifecycleState === "PROPOSAL_PENDING" ? "NEEDS_INTERPRETATION" : current.lifecycleState, recommendedNextAction: action === "confirm" ? null : current.recommendedNextAction, proposals: (current.proposals || []).map((item) => item.id === proposal.id ? result.proposal : item) } : current);
      setStatus(action === "confirm" ? "已确认 AI 产品结构建议" : "已拒绝 AI 产品结构建议");
      setError(null);
    } catch (cause: any) { setError(cause.message || "产品结构建议已过期，请重新理解"); }
  };

  const editProposal = async (proposal: ProductProposal) => {
    const first = proposal.features[0];
    const nextName = window.prompt("调整功能名称", first?.name || "");
    if (!nextName?.trim()) return;
    const nextGroup = window.prompt(`调整所属产品能力（可选：${proposal.groups.map((group) => group.proposalKey).join("、") || "未分组"}）`, first?.groupKey || "");
    if (nextGroup === null) return;
    try {
      const features = proposal.features.map((feature, index) => index === 0 ? { ...feature, name: nextName.trim(), groupKey: nextGroup.trim() || null, explicitlyUngrouped: !nextGroup.trim() } : feature);
      const result = await request<{ proposal: ProductProposal }>("/api/session/product-proposal/apply", { method: "POST", body: JSON.stringify({ proposal_id: proposal.id, expected_version: proposal.version, action: "update", patch: { features } }) });
      setProduct((current) => current ? { ...current, proposals: (current.proposals || []).map((item) => item.id === proposal.id ? result.proposal : item) } : current);
      setStatus("已保存产品结构草案调整，等待你确认");
      setError(null);
    } catch (cause: any) { setError(cause.message || "无法保存产品结构草案调整"); }
  };

  if (!workspace && !error) return <main className="loading"><div className="brand-mark">MW</div><h1>My Whiteboard</h1><p>{status}</p></main>;
  if (!workspace) return <main className="loading"><div className="brand-mark">MW</div><h1>My Whiteboard</h1><p>{error}</p><button className="primary-button" onClick={() => { setError(null); void Promise.all([refreshWorkspace(true), loadProductModel()]); }}>重试</button></main>;

  const agents = Object.values(workspace.entities.agents || {});
  const tasks = Object.values(workspace.entities.tasks || {});
  const contexts = Object.values(workspace.entities.contexts || {});
  const decisions = Object.values(workspace.entities.decisions || {});
  const artifacts = Object.values(workspace.entities.artifacts || {});
  const changes = Object.values(workspace.entities.changes || {});
  const hiddenFeatures = rawFeatures.filter((feature) => feature.hidden);
  const evidence = selectedFeature ? (selectedFeature.groundingRefs || []).map((id) => model?.evidence?.[id]).filter(Boolean) as Evidence[] : [];
  const understandingState = product?.understandingState || model?.understandingState || (product?.status === "PARTIAL" ? "PARTIAL" : product?.status === "FAILED" ? "FAILED" : "READY");
  const lifecycleState = product?.lifecycleState || "NEEDS_INTERPRETATION";
  const statusTitle = lifecycleState === "CONFIRMED" ? "产品结构已确认" : lifecycleState === "PROPOSAL_PENDING" ? "等待你确认" : understandingState === "NEEDS_INTERPRETATION" ? "需要 AI 解释" : understandingState === "UNSUPPORTED" ? "暂不支持" : understandingState === "PARTIAL" ? "部分理解" : understandingState === "FAILED" ? "理解失败" : "项目地图";
  const freshnessTitle = product?.freshness === "STALE" ? "代码发生变化，需要重新理解实现依据" : "与当前代码同步";

  return (
    <main className="product-shell">
      <header className="product-topbar">
        <div className="brand"><span className="brand-mark small">MW</span><div><strong>{workspace.project.name}</strong><small>My Whiteboard · 产品视图</small></div></div>
        <div className="topbar-status"><span className={`status-dot ${product?.freshness === "STALE" ? "stale" : ""}`} />{status}<button className="ghost-button" onClick={() => { void Promise.all([refreshWorkspace(true), loadProductModel()]); }}>刷新</button></div>
      </header>

      {view === "product" && (product?.proposals || []).filter((proposal) => proposal.status === "pending").map((proposal) => <div className="proposal-card global-proposal" key={proposal.id}><div><strong>产品结构等待你确认 · AI 根据项目证据整理出 {proposal.features.length} 个产品功能</strong><span>这是产品推断建议，不是代码事实；你可以逐项查看、调整后再确认。</span></div><div className="proposal-actions"><button className="primary-button" onClick={() => void applyProposal(proposal, "confirm")}>确认这组结构</button><button className="ghost-button" onClick={() => void editProposal(proposal)}>逐项查看与调整</button><button className="text-button danger-text" onClick={() => void applyProposal(proposal, "reject")}>拒绝</button></div></div>)}

      <aside className="product-sidebar">
        <div className="sidebar-section"><div className="sidebar-label">项目</div>
          <button className={`sidebar-item ${view === "product" ? "active" : ""}`} onClick={() => setView("product")}><span className="nav-icon">⌂</span><span><strong>产品地图</strong><small>产品能力地图</small></span></button>
          <button className={`sidebar-item ${view === "board" ? "active" : ""}`} onClick={() => setView("board")}><span className="nav-icon">▦</span><span><strong>技术白板</strong><small>代码架构与自由绘图</small></span></button>
          <button className={`sidebar-item ${view === "changes" ? "active" : ""}`} onClick={() => setView("changes")}><span className="nav-icon">↗</span><span><strong>变更</strong><small>变更入口</small></span></button>
        </div>
        <div className="sidebar-section"><div className="sidebar-label">功能导航</div>
          <label className="search-box"><span>⌕</span><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索功能" /></label>
          {searchQuery && <div className="search-results">{matchingFeatures.slice(0, 7).map((feature) => <button key={feature.id} onClick={() => { selectFeature(feature); setView("product"); }}><span className={`mini-state ${feature.actionability.toLowerCase()}`} /><span>{feature.name}</span></button>)}{!matchingFeatures.length && <p>没有找到匹配功能</p>}</div>}
        </div>
        <div className="sidebar-section"><div className="sidebar-label">理解状态</div><div className="state-summary"><span><i className="state-dot understood" />已识别</span><span><i className="state-dot grounded" />已有依据</span><span><i className="state-dot actionable" />可以规划</span></div></div>
        <div className="sidebar-section"><div className="sidebar-label">协作 Agent</div>{agents.length ? agents.slice(0, 4).map((agent) => <div className="agent-row" key={agent.id}><span className="avatar">{initials(agent.displayName || agent.id)}</span><span><strong>{agent.displayName || agent.id}</strong><small>{agentPresence(agent)}</small></span></div>) : <div className="sidebar-empty"><p>尚未检测到协作 Agent</p><small>My Whiteboard 通过 MCP 与 WorkBuddy、Codex 等外部 Agent 协作。</small><button className="text-button" onClick={() => setStatus("请在外部 Agent 中安装并连接 My Whiteboard MCP")}>查看连接方式</button></div>}</div>
      </aside>

      <section className="product-main">
        {view === "changes" && <section className="development-view"><div className="view-heading"><div><span className="eyebrow">DEVELOPMENT</span><h1>开发状态</h1><p>这里记录外部 Agent 的语义进度，并把报告与真实项目观察分开呈现。</p></div><button className="ghost-button" onClick={() => void loadDevelopment()}>刷新</button></div>{activeDevelopment ? <div className="development-card"><div className="development-card-header"><span className="node-kind">正在开发</span><strong>{activeDevelopment.goal}</strong><span className="understanding-pill">{activeDevelopment.label}</span></div><p>{activeDevelopment.summary}</p><div className="development-fact-grid"><span><strong>Agent 报告</strong><br />{activeDevelopment.summary}</span><span><strong>连接状态</strong><br />{activeDevelopment.connection?.label || "未知"}</span><span><strong>最近同步</strong><br />{activeDevelopment.connection?.lastSyncAt ? new Date(activeDevelopment.connection.lastSyncAt).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "暂无"}</span><span><strong>用户操作</strong><br />{activeDevelopment.userActionRequired ? "需要你处理" : "暂不需要你处理"}</span></div><div className="development-honesty"><span>报告 ≠ 事实</span><span>真实 Repo 观察由 Whiteboard 独立读取</span></div></div> : <div className="development-card empty-state"><h2>还没有正在进行的开发</h2><p>兼容的外部 Agent 开始有意义的产品开发后，这里会显示目标、里程碑和真实项目观察。</p><div className="change-count">当前 Workspace 中有 <strong>{changes.length}</strong> 个 Change</div></div>}</section>}
        <div className="breadcrumbs"><button onClick={() => { setView("product"); setSelectedId(null); setSelectedKind(null); }}>My Whiteboard</button><span>/</span><button onClick={() => setView("product")}>{selectedGroupForFeature?.name || selectedGroup?.name || "产品能力"}</button>{selectedFeature && <><span>/</span><strong>{selectedFeature.name}</strong></>}</div>
        {product?.freshness === "STALE" && <div className="freshness-banner"><div><strong>检测到项目发生变化</strong><span>代码发生变化，需要重新理解实现依据；这不代表功能不可理解或不可修改。</span></div><button className="primary-button" onClick={() => void loadProductModel(true)}>重新理解实现</button></div>}
        {view === "product" && activeDevelopment && <button className="active-development-card" onClick={() => setView("changes")}><span className="node-kind">正在开发</span><strong>{activeDevelopment.goal}</strong><span>{activeDevelopment.label} · {activeDevelopment.summary}</span><small>{activeDevelopment.connection?.label || "连接状态未知"}{activeDevelopment.connection?.lastSyncAt ? ` · 最近同步：${new Date(activeDevelopment.connection.lastSyncAt).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : ""}</small></button>}
        {view === "product" && lifecycleState === "NEEDS_INTERPRETATION" && <div className="interpretation-banner"><div><strong>项目代码已经读取，但还需要 AI Agent 整理产品功能</strong><span>当前已发现 {(model?.evidence && Object.values(model.evidence).filter((item) => item.type === "api").length) || 0} 个 API、{(model?.evidence && Object.values(model.evidence).filter((item) => item.type === "request").length) || 0} 个前端调用和 {(model?.evidence && Object.values(model.evidence).filter((item) => item.type === "database").length) || 0} 个数据持久化信号。</span></div><span className="proposal-hint">下一步：PRODUCT_STRUCTURE_PROPOSAL</span></div>}
        {view === "product" && understandingState === "UNSUPPORTED" && <div className="failed-card"><strong>当前项目类型暂不支持完整 Product Grounding</strong><span>目前正式支持 TS/JS Web App；可以先查看已有 Workspace 或明确请求代码架构分析。</span></div>}
        {view === "board" ? <section className="board-view"><div className="view-heading"><div><span className="eyebrow">BOARD VIEW</span><h1>{board?.title || "语义白板"}</h1><p>0.2 Board 仍由 Semantic Board State 驱动，Product View 与白板互不覆盖。</p></div><select value={activeBoardId || ""} onChange={(event) => chooseBoard(event.target.value)}>{Object.values(workspace.entities.boards).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div><div className="board-canvas" onPointerDownCapture={() => { userInteractedRef.current = true; }} onKeyDownCapture={() => { userInteractedRef.current = true; }}>{board ? <Excalidraw key={`${board.id}-${reloadKey}`} initialData={{ elements: initialElements }} onChange={onSceneChange as any} name={board.title} langCode="zh-CN" UIOptions={{ canvasActions: { loadScene: false } }} /> : <div className="empty-state"><h2>还没有白板</h2><p>让 Agent 创建第一个语义白板。</p></div>}</div></section> : view === "changes" ? <section className="changes-view"><div className="view-heading"><div><span className="eyebrow">CHANGES</span><h1>变更入口</h1><p>Phase 2 只提供入口，不提前实现完整 Change Planning。</p></div></div><div className="changes-card"><div className="large-icon">↗</div><h2>从产品能力进入下一步</h2><p>选择一个 ACTIONABLE 功能后，右侧可以查看“准备修改”入口。Change Contract、执行与验证将在后续阶段实现。</p><div className="change-count">当前 Workspace 中有 <strong>{changes.length}</strong> 个 Change</div></div></section> : <section className="product-view"><div className="view-heading"><div><span className="eyebrow">PRODUCT MAP</span><h1>{workspace.project.name}</h1><p>先看懂项目有什么，再决定下一步做什么。</p></div><div className="view-actions"><span className={`understanding-pill ${product?.status?.toLowerCase() || "failed"}`}>{statusTitle}</span><span className={`freshness-pill ${product?.freshness?.toLowerCase() || "stale"}`}>{freshnessTitle}</span><button className={`ghost-button ${focusMode ? "selected" : ""}`} onClick={() => setFocusMode((value) => !value)}>{focusMode ? "退出聚焦" : "聚焦当前功能"}</button><button className="ghost-button" onClick={() => void loadProductModel(true)}>重新理解</button></div></div>{product?.status === "PARTIAL" && <div className="partial-card"><strong>项目地图已建立，但仍有部分功能需要进一步分析。</strong><span>{rawFeatures.filter((feature) => feature.actionability === "ACTIONABLE").length} 个功能已有充分依据，{rawFeatures.filter((feature) => feature.actionability === "GROUNDED").length} 个功能需要重新确认。</span></div>}{product?.status === "FAILED" && <div className="failed-card"><strong>暂时无法建立项目地图</strong><span>{error || "没有得到可用的产品能力结果。"}</span><button className="primary-button" onClick={() => void loadProductModel(true)}>重试理解</button></div>}<div className="map-meta"><span>{groups.length} 个一级产品能力</span><span>{visibleFeatures.length} 个可识别功能</span><span>{model?.stats?.evidence || 0} 条 Evidence</span><span className="layout-hint">{Object.keys(model?.visualLayout || {}).length ? "已保留人工布局" : "布局可拖动保存"}</span></div><div className={`product-map ${focusMode ? "focus-mode" : ""}`}>{groups.map((group) => { const groupFeatures = group.featureIds.map((id) => featureById[id]).filter(Boolean).filter((feature) => !feature.hidden && matchingIds.has(feature.id)).filter((feature) => !focusIds || focusIds.has(feature.id)); if (!groupFeatures.length) return null; return <article className={`map-group ${selectedKind === "group" && selectedId === group.id ? "selected" : ""}`} key={group.id} onClick={() => selectGroup(group)}><div className="group-header"><div><span className="node-kind">一级产品能力</span><h2>{group.name}</h2><p>{group.description || "围绕项目目标组织的一组产品功能"}</p></div><span className="group-count">{groupFeatures.length}</span></div><div className="feature-grid">{groupFeatures.map((feature) => { const layout = model?.visualLayout?.[feature.id]; return <button className={`feature-card ${selectedKind === "feature" && selectedId === feature.id ? "selected" : ""}`} style={{ order: Math.round(Number(layout?.y || 0) * 1000 + Number(layout?.x || 0)) }} draggable onDragStart={(event) => event.dataTransfer.setData("text/my-whiteboard-feature", feature.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropFeature(event, feature.id)} onClick={(event) => { event.stopPropagation(); selectFeature(feature); }} key={feature.id}><span className={`feature-state ${feature.actionability.toLowerCase()}`} /><span className="feature-name">{feature.name}</span><span className="feature-subtitle">{feature.childFeatureIds?.length ? `${feature.childFeatureIds.length} 个子功能` : actionabilityLabel(feature.actionability)}</span>{layout && <span className="layout-saved">布局</span>}</button>; })}</div></article>; })}{!groups.length && <div className="empty-state"><h2>项目地图尚未建立</h2><p>点击“重新理解”扫描当前项目。</p></div>}</div></section>}
      </section>

      <aside className={`inspector-panel ${selectedNode ? "node-selected" : ""}`}>
        {selectedNode && <section className="node-inspector"><div className="inspector-kicker">CODE NODE INSPECTOR</div><div className="inspector-title-row"><div><h2>{selectedNode.label || selectedNodeCode.symbol || "代码节点"}</h2><span className="feature-type-label">{selectedNodeCode.kind || selectedNode.semanticType || "code"}</span></div><button className="icon-button" onClick={() => { setSelectedNode(null); setSelectedKind(null); setSelectedId(null); }}>×</button></div><p className="inspector-description">点击的代码节点来自 Semantic Board State；这里展示它与产品证据的真实关联。</p><div className="inspector-section"><h3>代码信息</h3><dl className="inspector-list"><div><dt>文件路径</dt><dd>{selectedNodeCode.file || "未提供"}</dd></div><div><dt>Source Classification</dt><dd>{selectedNodeCode.classification || "application_source"}</dd></div><div><dt>符号 / 行号</dt><dd>{selectedNodeCode.symbol || "文件"}{selectedNodeCode.line ? ` · 第 ${selectedNodeCode.line} 行` : ""}</dd></div></dl></div><div className="inspector-section"><h3>依赖关系</h3><p className="inspector-description">直接依赖：{(selectedNodeCode.dependencies || []).join("、") || "暂无"}</p><p className="inspector-description">被依赖：{(selectedNodeCode.reverseDependencies || []).join("、") || "暂无"}</p></div><div className="inspector-section"><h3>相关 API / Evidence</h3><div className="evidence-list">{nodeEvidence.slice(0, 8).map((item) => <article key={item.id}><strong>{item.type || item.kind || "evidence"}</strong><span>{item.target || item.source || "项目证据"}</span></article>)}{!nodeEvidence.length && <p>暂无关联 Evidence</p>}</div></div><div className="inspector-section"><h3>相关产品功能</h3>{nodeFeatures.length ? <div className="inspector-feature-list">{nodeFeatures.map((feature) => <button key={feature.id} onClick={() => { selectFeature(feature); setView("product"); }}><span className={`mini-state ${feature.actionability.toLowerCase()}`} />{feature.name}</button>)}</div> : <p className="inspector-description">暂无已关联产品功能</p>}{nodeFeatures.length > 0 && <button className="primary-button" onClick={() => { setView("product"); selectFeature(nodeFeatures[0]); }}>在 Product Map 中查看相关功能</button>}</div></section>}
        {selectedFeature ? <><div className="inspector-kicker">FEATURE INSPECTOR</div><div className="inspector-title-row"><div><h2>{selectedFeature.name}</h2><span className="feature-type-label">产品功能</span></div><button className="icon-button" onClick={() => { setSelectedId(null); setSelectedKind(null); }}>×</button></div><p className="inspector-description">{selectedFeature.description || "这个功能来自项目中的真实实现。"}</p><div className="inspector-section"><h3>产品信息</h3><dl className="inspector-list"><div><dt>所属能力</dt><dd>{selectedGroupForFeature?.name || "未分组"}</dd></div><div><dt>产品状态</dt><dd>{selectedFeature.productState || "已观察"}</dd></div><div><dt>子功能</dt><dd>{selectedFeature.childFeatureIds?.length || 0}</dd></div></dl></div><div className="inspector-section"><h3>理解状态</h3><div className={`understanding-card ${selectedFeature.actionability.toLowerCase()}`}><strong>{actionabilityLabel(selectedFeature.actionability)}</strong><p>{actionabilityLabels[selectedFeature.actionability]?.description}</p></div></div><div className="inspector-section"><div className="section-heading-row"><h3>Evidence 摘要</h3><button className="text-button" onClick={() => setShowEvidence((value) => !value)}>{showEvidence ? "收起" : "查看证据"}</button></div><div className="evidence-summary"><strong>{evidence.length}</strong><span>条关联证据</span><div>{Object.entries(evidence.reduce<Record<string, number>>((counts, item) => { const kind = item.kind || item.type || "other"; counts[kind] = (counts[kind] || 0) + 1; return counts; }, {})).map(([kind, count]) => <span key={kind}>{kind} {count}</span>)}</div></div>{showEvidence && <div className="evidence-list">{evidence.slice(0, 8).map((item) => <article key={item.id}><strong>{item.kind || item.type || "evidence"}</strong><span>{item.source || item.target || "项目证据"}{item.line ? ` · 第 ${item.line} 行` : ""}</span><small>{item.certainty === "confirmed" ? "已确认" : "推断"}</small></article>)}</div>}</div><div className="inspector-section"><h3>产品操作</h3><div className="action-stack"><button className="secondary-button" onClick={() => setStatus(`已记录“了解 ${selectedFeature.name}”`)}>了解这个功能</button><button className="secondary-button" onClick={() => setStatus(`已聚焦分析“${selectedFeature.name}”`)}>深入分析</button>{selectedFeature.actionability === "ACTIONABLE" && <button className="primary-button" onClick={() => { setView("changes"); setStatus(`已准备从“${selectedFeature.name}”进入变更规划`); }}>准备修改</button>}</div></div><div className="inspector-section"><h3>人工组织</h3><label className="field-label">名称<input value={editingName} onChange={(event) => setEditingName(event.target.value)} onBlur={() => { if (editingName.trim() && editingName !== selectedFeature.name) void correctFeature({ name: editingName.trim() }, "已保存功能名称"); }} /></label><label className="field-label">所属产品能力<select value={editingGroup} onChange={(event) => { setEditingGroup(event.target.value); void correctFeature({ groupId: event.target.value }, "已移动到新的产品能力"); }}><option value="">未分组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><div className="inline-actions"><button className="text-button" onClick={() => void correctFeature({ hidden: !selectedFeature.hidden }, selectedFeature.hidden ? "已恢复到产品地图" : "已从产品地图隐藏")}>{selectedFeature.hidden ? "恢复显示" : "隐藏功能"}</button>{model?.humanIntent?.featureCorrections?.[selectedFeature.id] && <button className="text-button danger-text" onClick={() => void revertFeature()}>恢复自动组织</button>}</div></div></> : selectedGroup ? <><div className="inspector-kicker">PRODUCT GROUP</div><div className="inspector-title-row"><div><h2>{selectedGroup.name}</h2><span className="feature-type-label">一级产品能力</span></div><button className="icon-button" onClick={() => { setSelectedId(null); setSelectedKind(null); }}>×</button></div><p className="inspector-description">{selectedGroup.description || "这是产品地图中的组织层，不是一个可直接执行的功能。"}</p><div className="group-inspector-note"><strong>产品分组</strong><p>分组只负责组织 Feature，不参与 Actionability，也不能直接作为 Change Target。</p></div><div className="inspector-section"><h3>包含功能</h3><div className="inspector-feature-list">{selectedGroup.featureIds.map((id) => featureById[id]).filter(Boolean).map((feature) => <button key={feature.id} onClick={() => selectFeature(feature)}><span className={`mini-state ${feature.actionability.toLowerCase()}`} />{feature.name}</button>)}</div></div></> : <><div className="inspector-kicker">CONTEXT / INSPECTOR</div><h2>选择一个功能</h2><p className="inspector-description">点击 Product Map 中的功能，查看它的产品信息、理解状态和 Evidence 摘要。</p><div className="inspector-empty-card"><strong>从这里开始</strong><span>先展开一个一级产品能力，再选择你想了解的功能。</span></div>{hiddenFeatures.length > 0 && <div className="inspector-section"><h3>隐藏功能</h3><div className="inspector-feature-list">{hiddenFeatures.map((feature) => <button key={feature.id} onClick={() => selectFeature(feature)}><span className="mini-state grounded" />{feature.name}<small>已隐藏</small></button>)}</div></div>}{contexts.slice(0, 2).map((context) => <article className="context-card" key={context.id}><span>{context.kind || "项目上下文"}</span><strong>{context.title}</strong><p>{context.content}</p></article>)}</>}
        {ignored.length > 0 && <div className="warning"><strong>部分画布元素未持久化</strong><p>{ignored.length} 个元素没有对应的语义类型，只保留在当前会话。</p></div>}
        {error && <div className="error"><strong>需要处理</strong><p>{error}</p></div>}
      </aside>
      <footer className="product-footer"><span>Workspace v{workspace.workspaceVersion}</span><span>·</span><span>{model?.projectModelVersion ? `ProjectModel v${model.projectModelVersion}` : "ProjectModel 未就绪"}</span><span>·</span><span>{model?.repoSnapshot?.dirty ? "工作区有未提交代码变化" : "代码状态稳定"}</span><span className="footer-spacer" /><span>{loading ? "正在读取" : "本地持久化已开启"}</span></footer>
    </main>
  );
}
