import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import {
  excalidrawSceneToSemanticChanges,
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
  if (!response.ok) throw Object.assign(new Error(value.error?.message || "Workspace request failed"), { code: value.error?.code, details: value.error?.details });
  return value;
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
  const saveTimerRef = useRef<number | null>(null);
  const selectionTimerRef = useRef<number | null>(null);
  const lastSelectionRef = useRef("");
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const initialChangeRef = useRef(true);

  const refresh = useCallback(async (resetScene = false) => {
    const result = await request<SessionResponse>("/api/session");
    setWorkspace(result.workspace);
    const boards = result.workspace.entities.boards;
    const nextBoardId = activeBoardId && boards[activeBoardId] ? activeBoardId : result.activeBoardId && boards[result.activeBoardId] ? result.activeBoardId : Object.keys(boards)[0] || null;
    setActiveBoardId(nextBoardId);
    boardRef.current = nextBoardId ? boards[nextBoardId] : null;
    setStatus(`Workspace v${result.workspace.workspaceVersion} · 已同步`);
    if (resetScene) {
      initialChangeRef.current = true;
      setReloadKey((value) => value + 1);
    }
    return result.workspace;
  }, [activeBoardId]);

  useEffect(() => {
    refresh(true).catch((cause) => {
      setError(cause.message);
      setStatus("无法连接 Workspace");
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
    const diff = excalidrawSceneToSemanticChanges(currentBoard, latestSceneRef.current);
    setIgnored(diff.ignored);
    if (!diff.changes.length) return;
    savingRef.current = true;
    setStatus("正在保存 Semantic Board State…");
    try {
      await request("/api/session/transaction", {
        method: "POST",
        body: JSON.stringify({
          transaction: {
            actor: { id: "human", displayName: "User", client: "web-workspace" },
            operations: [{ type: "board.apply", boardId: currentBoard.id, changes: diff.changes }],
          },
        }),
      });
      await refresh(false);
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
    const boardId = boardRef.current?.id;
    if (boardId) persistSelection(boardId, appState.selectedElementIds || {});
    if (initialChangeRef.current) {
      initialChangeRef.current = false;
      return;
    }
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => persistLatestScene(), 500);
  }, [persistLatestScene, persistSelection]);

  const chooseBoard = (id: string) => {
    setActiveBoardId(id);
    const selected = workspace?.entities.boards[id] || null;
    boardRef.current = selected;
    initialChangeRef.current = true;
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
        <div className="brand"><span className="brand-mark small">MW</span><div><strong>{workspace.project.name}</strong><small>My Whiteboard · Semantic Workspace</small></div></div>
        <div className="topbar-actions"><span className="status-dot" />{status}<button onClick={() => refresh(true)}>刷新</button></div>
      </header>
      <aside className="left-panel">
        <section><div className="section-label">Boards</div>{Object.values(workspace.entities.boards).map((item) => <button className={item.id === activeBoardId ? "nav-item active" : "nav-item"} key={item.id} onClick={() => chooseBoard(item.id)}><span>●</span><div><strong>{item.title}</strong><small>{Object.keys(item.elements || {}).length} elements · v{item.version}</small></div></button>)}</section>
        <section><div className="section-label">Agents</div>{agents.length ? agents.map((agent) => <div className="agent" key={agent.id}><span className="avatar">{(agent.displayName || agent.id).slice(0, 1).toUpperCase()}</span><div><strong>{agent.displayName || agent.id}</strong><small>{agent.status || "connected"}</small></div></div>) : <p className="empty-copy">Single-Agent mode. Agent identity appears after connection.</p>}</section>
      </aside>
      <section className="board-panel">
        {board ? <Excalidraw key={`${board.id}-${reloadKey}`} initialData={{ elements: initialElements }} onChange={onSceneChange as any} name={board.title} UIOptions={{ canvasActions: { loadScene: false } }} /> : <div className="empty-board"><h2>还没有 Board</h2><p>让 Agent 创建第一个 Semantic Board。</p></div>}
      </section>
      <aside className="right-panel">
        <div className="section-label">Project Context</div>
        <h2>{board?.title || "Workspace"}</h2>
        <p>{workspace.project.overview || "Project Overview 尚未填写。"}</p>
        <div className="domain-list">{contexts.slice(0, 3).map((context) => <article key={context.id}><span>{context.kind || "context"}</span><strong>{context.title}</strong><p>{context.content}</p></article>)}</div>
        <dl><div><dt>Workspace Version</dt><dd>{workspace.workspaceVersion}</dd></div><div><dt>Board Version</dt><dd>{board?.version || "—"}</dd></div><div><dt>Authority</dt><dd>Semantic State</dd></div></dl>
        <div className="section-label domain-heading">Decisions</div>
        <div className="domain-list compact">{decisions.slice(0, 3).map((decision) => <article key={decision.id}><span>{decision.status || "proposed"}</span><strong>{decision.title}</strong><p>{decision.rationale}</p></article>)}{!decisions.length && <p className="empty-copy">No decisions yet.</p>}</div>
        <div className="section-label domain-heading">Artifacts</div>
        <div className="domain-list compact">{artifacts.slice(0, 3).map((artifact) => <article key={artifact.id}><span>{artifact.kind}</span><strong>{artifact.title}</strong><p>{artifact.path || artifact.uri || "Board artifact"}</p></article>)}{!artifacts.length && <p className="empty-copy">No artifacts yet.</p>}</div>
        <div className="section-label domain-heading">Handoffs · Messages</div>
        <div className="domain-list compact">{handoffs.slice(-2).map((handoff) => <article key={handoff.id}><span>{handoff.status} · {handoff.fromAgentId} → {handoff.toAgentId}</span><strong>{handoff.title}</strong><p>{handoff.summary}</p></article>)}{messages.slice(-2).map((message) => <article key={message.id}><span>{message.kind} · {message.fromAgentId}</span><strong>{message.toAgentId || message.channel || "workspace"}</strong><p>{message.body}</p></article>)}{!handoffs.length && !messages.length && <p className="empty-copy">No Agent collaboration activity yet.</p>}</div>
        {ignored.length > 0 && <div className="warning"><strong>暂未持久化</strong><p>{ignored.length} 个 Excalidraw 元素尚无 Semantic 类型，仍只存在于当前会话。</p></div>}
        {error && <div className="error"><strong>需要处理</strong><p>{error}</p></div>}
      </aside>
      <footer className="task-panel"><div><span className="section-label">Tasks</span><strong>{tasks.length} 项</strong></div><div className="task-strip">{tasks.length ? tasks.slice(0, 5).map((task) => <span key={task.id}><b data-status={task.status || "todo"} />{task.title} · {task.status || "todo"}{task.assigneeAgentId ? ` · ${task.assigneeAgentId}` : ""}</span>) : <span>Agent 尚未创建任务。</span>}</div></footer>
    </main>
  );
}
