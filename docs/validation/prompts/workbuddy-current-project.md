# WorkBuddy Current-Project Acceptance Prompt

这是 My Whiteboard 0.2 的真实第二客户端验收。不要读取或索要 Codex 的完整聊天记录，也不要直接导入项目 Core 模块；所有 Workspace 读取和写入必须使用已信任的 `my-whiteboard` MCP 工具。

项目根目录：

`C:\Users\NCKZ\Documents\New project 2\my-whiteboard-marketplace`

先只完成首次加入与理解，不修改 Board、Task、Decision、Context、Artifact、Handoff 或 Message：

1. 调用 `agent_sync`，使用独立身份：
   - id: `workbuddy-validation-agent`
   - displayName: `WorkBuddy Validation Agent`
   - client: `WorkBuddy`
   - status: `connected`
   - capabilities: `ui-ux`, `workspace-review`, `semantic-board-state`
   - since_version: `0`
2. 通过 MCP 读取当前 Workspace；不得使用 Codex 私人聊天作为背景。
3. 根据 Workspace 自己说明：
   - 项目目标是什么；
   - Codex 已完成什么；
   - 当前 Architecture Board 表达什么；
   - 现有 Tasks、Decisions、Artifacts 和 Agents；
   - 哪些验收仍待完成；
   - 你认为下一项 UI / UX 任务应该是什么。
4. 结尾报告实际调用的 MCP 工具完整名称、Workspace Version、WorkBuddy Agent ID/Entity Version，以及读取到的 Context/Task/Decision/Artifact/Board/Agent 数量。

如果 MCP 工具不可用或调用失败，停止并原样报告工具名称、错误代码和错误信息；不要改用直接 Core 调用冒充 MCP 通过。
