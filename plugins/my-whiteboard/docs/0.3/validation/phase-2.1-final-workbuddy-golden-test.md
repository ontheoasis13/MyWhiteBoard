# Phase 2.1 Final WorkBuddy Golden Test

状态：PENDING — 由外部 WorkBuddy clean-room session 执行。

使用新 session、新建 `.my-whiteboard`，不要手工编辑 JSON，不调用 `board_apply`，不要预先告诉 Agent Feature/Group 答案。

唯一用户指令：

> 用 My Whiteboard 帮我理解 central-soe-content-workbench 这个项目。我不会看代码，我想知道这个软件主要有哪些功能，以及以后如果我要修改某个功能，应该从哪里开始。

验收重点：

1. Agent 先读取 runtime 信息并进行 grounding；
2. Agent 解释 Evidence 后创建 Product Structure Proposal；
3. Agent 在 proposal 后停止并请用户到 Product View 审阅；
4. Agent 不调用 MCP confirm/reject，不生成替代 HTML/PNG/project-map artifact；
5. Product View 中 group/feature 结构关系与持久化一致，人工确认 provenance 为 Product View UI；
6. `项目地图.html` 等自生成 artifact 不主导 Product Signals；`public/index.html` 仍被识别为 `ui_entry`；
7. Agent Presence 显示已注册/最近活动语义，不把无 heartbeat 直接显示为离线。

WorkBuddy 完成后，请把 MCP 工具名、Workspace 版本、proposal 状态、确认 provenance、observed file classification 与是否生成替代 artifact 回传给 Codex。
