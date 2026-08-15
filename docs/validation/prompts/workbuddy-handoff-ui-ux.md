# WorkBuddy Handoff and UI/UX Collaboration

继续使用真实 `my-whiteboard` MCP 工具完成当前 `Complex AI Workbench` 协作。不要读取 `.my-whiteboard/workspace.json`，不要直接调用 Core，不要使用 Codex 私人聊天。

项目根目录：

`C:\Users\NCKZ\Documents\New project 2\my-whiteboard-marketplace`

## 1. 增量同步与读取

1. 调用 `agent_sync`，保持身份 `workbuddy-validation-agent`，`since_version=28`。
2. 确认 Delta 中包含：
   - Workspace v29：Task `task-workbuddy-ui-ux` created；
   - Workspace v30：Handoff `codex-to-workbuddy-ui-ux` created；
   - Workspace v31：Message `message-codex-ui-ux-request` created。
3. 调用 `messages_get` 读取发给 `workbuddy-validation-agent` 的消息；不要全量读取私人聊天。

## 2. 接受交接并开始任务

1. `handoff_update`：
   - handoff_id: `codex-to-workbuddy-ui-ux`
   - expected_version: `1`
   - patch.status: `accepted`
2. `tasks_apply`：
   - 更新 `task-workbuddy-ui-ux`
   - expected_version: `1`
   - status: `in_progress`

## 3. 完成独立 UI/UX 工作

所有新实体使用稳定 ID，并保留 Entity Version：

1. 创建 Context `ctx-workbuddy-ui-review`：
   - kind: `review`
   - title: `WorkBuddy Chinese Workspace UI/UX Review`
   - content: 仅根据 Workspace/Handoff 总结信息层级、项目导航、Agent 面板、Task 面板和 scene-only 元素提示建议。
   - sources: `plugins/my-whiteboard/apps/workspace/src/App.tsx`、`plugins/my-whiteboard/adapters/excalidraw-adapter.mjs`
2. 在 Board `architecture-workbench` 创建以下 Semantic 元素，不修改现有 Core/Persistence 节点：
   - Section `section-workbuddy-ui-ux`，label=`WorkBuddy UI/UX Review`，layout 建议 x=80, y=520, width=720, height=260
   - Node `ui-project-navigation`，label=`Project Navigation`，layout 建议 x=120, y=610, width=180, height=80
   - Node `ui-agent-panel`，label=`Agent Panel`，layout 建议 x=350, y=610, width=160, height=80
   - Node `ui-task-panel`，label=`Task Panel`，layout 建议 x=560, y=610, width=160, height=80
   - Edge `ui-nav-to-agent`：`ui-project-navigation` → `ui-agent-panel`
   - Edge `ui-agent-to-task`：`ui-agent-panel` → `ui-task-panel`
3. 创建 Decision `decision-workspace-navigation`：
   - title: `Expose project navigation in the Workspace shell`
   - status: `proposed`
   - rationale: 说明是否应在不改变 Semantic Board 权威性的前提下加入项目导航/文件浏览入口。
   - boardElementIds: `ui-project-navigation`、`ui-agent-panel`、`ui-task-panel`
4. 将 `task-workbuddy-ui-ux` 从 Entity Version 2 更新为 `completed`。
5. 将 Handoff `codex-to-workbuddy-ui-ux` 从 Entity Version 2 更新为 `completed`，补充完成摘要到 patch（若 schema 允许）；如果摘要字段不允许，只更新状态并在 Message 中报告。
6. 通过 `message_send` 回复 `codex-validation-agent`：
   - kind: `response`
   - channel: `ui-ux-validation`
   - body: 概述 Context、Decision、Board 元素、Task 和 Handoff 的结果
   - relatedEntityRefs 至少包含 Handoff、Task、Decision、Context、Board。

## 4. 最终只读核对

调用 `workspace_get_changes`，使用本轮开始前的游标 `31`，再调用一次 `workspace_get(include_events=false)`。

报告：

- 实际调用的 MCP 工具全名；
- 接受/完成后的 Handoff Entity Version；
- Task Entity Version/status；
- Context、Decision 与六个 Board Element ID/version；
- Message ID/version；
- 最终 Workspace Version；
- 从 v31 返回的 Delta 事件数和类型；
- 是否有任何失败、错误码或直接 Core/文件读取。

若任何工具失败，停止后续写入，原样报告工具、错误码、失败所属步骤和已经成功提交的 Workspace Version；不要绕过 MCP。
