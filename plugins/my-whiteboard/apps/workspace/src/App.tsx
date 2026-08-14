import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import {
  excalidrawSceneToSemanticChangesSince,
  semanticBoardToExcalidrawSkeletons,
} from "../../../adapters/excalidraw-adapter.mjs";

type SemanticElement = {
  id: string;
  kind: string;
  semanticType: string;
  label: string;
  version: number;
  properties?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

type Board = {
  id: string;
  title: string;
  boardType: string;
  version: number;
  elements: Record<string, SemanticElement>;
  order: string[];
};

type Workspace = {
  workspaceVersion: number;
  project: { id: string; name: string; overview?: string };
  entities: {
    boards: Record<string, Board>;
    agents: Record<string, { id: string; displayName?: string; status?: string }>;
    tasks: Record<string, { id: string; title: string; status?: string; priority?: string; assigneeAgentId?: string | null }>;
    contexts: Record<string, { id: string; title: string; content: string; kind?: string }>;
    decisions: Record<string, { id: string; title: string; rationale: string; status?: string }>;
    artifacts: Record<string, { id: string; title: string; kind: string; path?: string | null; uri?: string | null }>;
    handoffs: Record<string, { id: string; title: string; summary: string; status: string; fromAgentId: string; toAgentId: string }>;
    messages: Record<string, { id: string; body: string; kind: string; fromAgentId: string; toAgentId?: string | null; channel?: string }>;
  };
};

type SessionResponse = { workspace: Workspace; activeBoardId: string | null };
type SceneElement = Record<string, any>;

function sessionHeaders() {
  const params = new URLSearchParams(location.search);
  return {
    "x-my-whiteboard-session": params.get("session") || "",
    "x-my-whiteboard-token": params.get("token") || "",
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...sessionHeaders(), ...(init.headers || {}) },
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error?.message || "工作区请求失败"), { code: value.error?.code, details: value.error?.details });
  return value;
}

const uiLabels: Record<string, string> = {
  accepted: "已接受",
  active: "进行中",
  completed: "已完成",
  connected: "已连接",
  context: "上下文",
  "current-state": "当前状态",
  disconnected: "已断开",
  done: "已完成",
  draft: "草稿",
  failed: "失败",
  file: "文件",
  goal: "目标",
  in_progress: "进行中",
  message: "消息",
  open: "待处理",
  "open-questions": "待解决问题",
  pending: "待处理",
  proposed: "提议中",
  rejected: "已拒绝",
  requirements: "需求",
  todo: "待办",
  board: "白板",
  working: "工作中",
  workspace: "工作区",
};

function uiLabel(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return uiLabels[value.toLowerCase()] || value;
}

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(new URLSearchParams(location.search).get("board"));
  const [status, setStatus] = useState("正在连接本地 Workspace…");
  const [error, setError] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<Array<{ id: string; type: string }>>([]);
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

  const refresh = useCallback(async (resetScene = false) => {
    const result = await request<SessionResponse>("/api/session");
    setWorkspace(result.workspace);
    const boards = result.workspace.entities.boards;
    const nextBoardId = activeBoardId && boards[activeBoardId] ? activeBoardId : result.activeBoardId && boards[result.activeBoardId] ? result.activeBoardId : Object.keys(boards)[0] || null;
    setActiveBoardId(nextBoardId);
    boardRef.current = nextBoardId ? boards[nextBoardId] : null;
    setStatus(`工作区 v${result.workspace.workspaceVersion} · 已同步`);
    if (resetScene) {
      userInteractedRef.current = false;
      hydratedSceneRef.current = [];
      lastSelectionRef.current = "";
      setReloadKey((value) => value + 1);
    }
    return result.workspace;
  }, [activeBoardId]);

  useEffect(() => {
    refresh(true).catch((cause) => {
      setError(cause.message);
      setStatus("无法连接工作区");
    });
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (selectionTimerRef.current) window.clearTimeout(selectionTimerRef.current);
    };
  }, []);

  const board = activeBoardId ? workspace?.entities.boards[activeBoardId] || null : null;
  useEffect(() => { boardRef.current = board || null; }, [board]);

  const initialElements = useMemo(() => {
    if (!board) return [];
    return convertToExcalidrawElements(semanticBoardToExcalidrawSkeletons(board) as any, { regenerateIds: false });
  }, [board?.id, reloadKey]);

  const persistLatestScene = useCallback(async () => {
    if (savingRef.current) {
      dirtyRef.current = true;
      return;
    }
    const currentBoard = boardRef.current;
    if (!currentBoard) return;
    const sceneToSave = latestSceneRef.current;
    const diff = excalidrawSceneToSemanticChangesSince(currentBoard, hydratedSceneRef.current, sceneToSave);
    setIgnored(diff.ignored);
    if (!diff.changes.length) {
      hydratedSceneRef.current = sceneToSave;
      return;
    }
    savingRef.current = true;
    setStatus("正在保存语义白板状态…");
    try {
      await request("/api/session/transaction", {
        method: "POST",
        body: JSON.stringify({
          transaction: {
            actor: { id: "human", displayName: "用户", client: "web-workspace" },
            operations: [{ type: "board.apply", boardId: currentBoard.id, changes: diff.changes }],
          },
        }),
      });
      await refresh(false);
      hydratedSceneRef.current = sceneToSave;
      setError(null);
    } catch (cause: any) {
      if (cause.code === "VERSION_CONFLICT") {
        setError("该元素已被另一个 Agent 修改。已停止覆盖，请刷新后重试。");
        setStatus("检测到版本冲突");
      } else {
        setError(cause.message);
        setStatus("保存失败");
      }
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        window.setTimeout(() => persistLatestScene(), 0);
      }
    }
  }, [refresh]);

  const persistSelection = useCallback((boardId: string, selectedElementIds: Record<string, boolean>) => {
    const elementIds = Object.keys(selectedElementIds || {}).sort();
    const signature = `${boardId}:${elementIds.join(",")}`;
    if (signature === lastSelectionRef.current) return;
    lastSelectionRef.current = signature;
    if (selectionTimerRef.current) window.clearTimeout(selectionTimerRef.current);
    selectionTimerRef.current = window.setTimeout(() => {
      request("/api/session/selection", {
        method: "POST",
        body: JSON.stringify({ boardId, elementIds }),
      }).catch((cause) => setError(`无法同步当前选择：${cause.message}`));
    }, 200);
  }, []);

  const onSceneChange = useCallback((elements: readonly SceneElement[], appState: { selectedElementIds?: Record<string, boolean> }) => {
    latestSceneRef.current = elements;
    if (!userInteractedRef.current) {
      hydratedSceneRef.current = elements;
      return;
    }
    const boardId = boardRef.current?.id;
    if (boardId) persistSelection(boardId, appState.selectedElementIds || {});
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => persistLatestScene(), 500);
  }, [persistLatestScene, persistSelection]);

  const markUserInteraction = useCallback(() => {
    userInteractedRef.current = true;
  }, []);

  const chooseBoard = (id: string) => {
    setActiveBoardId(id);
    const selected = workspace?.entities.boards[id] || null;
    boardRef.current = selected;
    userInteractedRef.current = false;
    hydratedSceneRef.current = [];
    lastSelectionRef.current = "";
    setReloadKey((value) => value + 1);
    const url = new URL(location.href);
    url.searchParams.set("board", id);
    history.replaceState(null, "", url);
  };

  if (!workspace) {
    return <main className="loading"><div className="brand-mark">MW</div><h1>My Whiteboard</h1><p>{error || status}</p></main>;
  }

  const agents = Object.values(workspace.entities.agents || {});
  const tasks = Object.values(workspace.entities.tasks || {});
  const contexts = Object.values(workspace.entities.contexts || {});
  const decisions = Object.values(workspace.entities.decisions || {});
  const artifacts = Object.values(workspace.entities.artifacts || {});
  const handoffs = Object.values(workspace.entities.handoffs || {});
  const messages = Object.values(workspace.entities.messages || {});

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark small">MW</span><div><strong>{workspace.project.name}</strong><small>My Whiteboard · 语义工作区</small></div></div>
        <div className="topbar-actions"><span className="status-dot" />{status}<button onClick={() => refresh(true)}>刷新</button></div>
      </header>
      <aside className="left-panel">
        <section><div className="section-label">白板</div>{Object.values(workspace.entities.boards).map((item) => <button className={item.id === activeBoardId ? "nav-item active" : "nav-item"} key={item.id} onClick={() => chooseBoard(item.id)}><span>●</span><div><strong>{item.title}</strong><small>{Object.keys(item.elements || {}).length} 个元素 · v{item.version}</small></div></button>)}</section>
        <section><div className="section-label">智能体</div>{agents.length ? agents.map((agent) => <div className="agent" key={agent.id}><span className="avatar">{(agent.displayName || agent.id).slice(0, 1).toUpperCase()}</span><div><strong>{agent.displayName || agent.id}</strong><small>{uiLabel(agent.status, "已连接")}</small></div></div>) : <p className="empty-copy">当前为单智能体模式，连接后将在此显示智能体身份。</p>}</section>
      </aside>
      <section className="board-panel" onPointerDownCapture={markUserInteraction} onKeyDownCapture={markUserInteraction}>
        {board ? <Excalidraw key={`${board.id}-${reloadKey}`} initialData={{ elements: initialElements }} onChange={onSceneChange as any} name={board.title} langCode="zh-CN" UIOptions={{ canvasActions: { loadScene: false } }} /> : <div className="empty-board"><h2>还没有白板</h2><p>让智能体创建第一个语义白板。</p></div>}
      </section>
      <aside className="right-panel">
        <div className="section-label">项目上下文</div>
        <h2>{board?.title || "工作区"}</h2>
        <p>{workspace.project.overview || "尚未填写项目概述。"}</p>
        <div className="domain-list">{contexts.slice(0, 3).map((context) => <article key={context.id}><span>{uiLabel(context.kind, "上下文")}</span><strong>{context.title}</strong><p>{context.content}</p></article>)}</div>
        <dl><div><dt>工作区版本</dt><dd>{workspace.workspaceVersion}</dd></div><div><dt>白板版本</dt><dd>{board?.version || "—"}</dd></div><div><dt>权威状态</dt><dd>语义状态</dd></div></dl>
        <div className="section-label domain-heading">决策</div>
        <div className="domain-list compact">{decisions.slice(0, 3).map((decision) => <article key={decision.id}><span>{uiLabel(decision.status, "提议中")}</span><strong>{decision.title}</strong><p>{decision.rationale}</p></article>)}{!decisions.length && <p className="empty-copy">暂无决策。</p>}</div>
        <div className="section-label domain-heading">产物</div>
        <div className="domain-list compact">{artifacts.slice(0, 3).map((artifact) => <article key={artifact.id}><span>{uiLabel(artifact.kind, "产物")}</span><strong>{artifact.title}</strong><p>{artifact.path || artifact.uri || "白板产物"}</p></article>)}{!artifacts.length && <p className="empty-copy">暂无产物。</p>}</div>
        <div className="section-label domain-heading">交接 · 消息</div>
        <div className="domain-list compact">{handoffs.slice(-2).map((handoff) => <article key={handoff.id}><span>{uiLabel(handoff.status, "待处理")} · {handoff.fromAgentId} → {handoff.toAgentId}</span><strong>{handoff.title}</strong><p>{handoff.summary}</p></article>)}{messages.slice(-2).map((message) => <article key={message.id}><span>{uiLabel(message.kind, "消息")} · {message.fromAgentId}</span><strong>{message.toAgentId || uiLabel(message.channel, "工作区")}</strong><p>{message.body}</p></article>)}{!handoffs.length && !messages.length && <p className="empty-copy">暂无智能体协作活动。</p>}</div>
        {ignored.length > 0 && <div className="warning"><strong>暂未持久化</strong><p>{ignored.length} 个画布元素尚无语义类型，仍只存在于当前会话。</p></div>}
        {error && <div className="error"><strong>需要处理</strong><p>{error}</p></div>}
      </aside>
      <footer className="task-panel"><div><span className="section-label">任务</span><strong>{tasks.length} 项</strong></div><div className="task-strip">{tasks.length ? tasks.slice(0, 5).map((task) => <span key={task.id}><b data-status={task.status || "todo"} />{task.title} · {uiLabel(task.status, "待办")}{task.assigneeAgentId ? ` · ${task.assigneeAgentId}` : ""}</span>) : <span>智能体尚未创建任务。</span>}</div></footer>
    </main>
  );
}
