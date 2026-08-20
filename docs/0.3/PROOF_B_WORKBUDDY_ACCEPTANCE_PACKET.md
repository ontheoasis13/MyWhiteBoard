# Proof B WorkBuddy Acceptance Packet

状态：`TECHNICAL READY — REAL WORKBUDDY ACCEPTANCE PENDING`

这是给人工打开的 WorkBuddy 客户端使用的隔离验收包。Codex 不启动、搜索或模拟 WorkBuddy。

## Validation Repo

- 路径：`C:\Users\NCKZ\Documents\New project 2\proof-b-validation`
- 基线 Git Revision：`3550be483b271199f6a71f2a1b2407849cb34880`
- 当前 My Whiteboard Workspace Version：`3`
- Agent ID：`proof-b-external-host`
- Change ID：`change-proof-b-health-endpoint`
- Change Entity Version：`1`
- Change Status：`approved`

仓库是隔离的 JavaScript Web 项目，基线已有 `GET /api/status` 和一项测试。WorkBuddy 只需在该仓库完成一个真实 approved Change。

## Approved Change Contract

目标：新增 `GET /api/health`，返回：

```json
{"service":"proof-b-validation","status":"healthy"}
```

约束：

- 保持现有 `GET /api/status` 不变。
- 主要修改范围为 `src/server.js`、`test/server.test.js`，必要时可更新说明文档。
- 不新增运行时依赖。
- 完成后 `npm test` 和 `npm run typecheck` 必须通过。

## WorkBuddy 需要调用的 MCP 工具

请先重载已信任的 `my-whiteboard` MCP 连接，使工具列表包含最新的 Hosted Execution 工具（总数 40）：

1. `mcp__my-whiteboard__agent_sync`
2. `mcp__my-whiteboard__workspace_get` 或 `mcp__my-whiteboard__change_get`
3. `mcp__my-whiteboard__execution_claim`
4. `mcp__my-whiteboard__execution_report`
5. `mcp__my-whiteboard__execution_get`
6. `mcp__my-whiteboard__workspace_get_changes`

不同客户端可能把连字符显示为下划线，但工具语义和参数不变。

## 给 WorkBuddy 的最小验收指令

```text
你是 Proof B 外部 MCP Agent Host。只在以下真实仓库工作：
C:\Users\NCKZ\Documents\New project 2\proof-b-validation

1. 使用 agent_id=proof-b-external-host 同步 Workspace，确认 approved Change：
   change-proof-b-health-endpoint
2. 调用 execution_claim：
   project_root = 上述仓库路径
   change_id = change-proof-b-health-endpoint
   agent_id = proof-b-external-host
3. 根据 Change Contract 修改真实 Repo，新增 GET /api/health，并补充对应测试。
4. 在真实 Repo 执行 npm test 和 npm run typecheck。
5. 成功时调用 execution_report(status=completed)，提供 output/result 摘要；
   失败或中断时调用 execution_report(status=failed 或 interrupted)，提供 error。
6. 调用 execution_get，确认 executionId、changeId、agentId、lifecycle 和 Repo evidence 已写入。
不要调用 Core 模块、不要伪造结果、不要复制 Prompt 后声称完成。
```

## WorkBuddy 完成后 Codex 要核验的证据

- `Execution.status` 为 `completed`、`failed` 或 `interrupted`，并且不能仍为 `running`。
- `Execution.changeId` 与 `change-proof-b-health-endpoint` 一致。
- `Execution.agentId` 与 `proof-b-external-host` 一致。
- lifecycle 至少包含 `claimed`、`started`、`running` 和最终状态。
- `repoBefore.revision` 等于基线 `3550be483b271199f6a71f2a1b2407849cb34880`。
- `repoAfter`、`repoChange.files` 和 revision 证据已持久化；变更范围符合 Contract。
- 重新读取 `src/server.js`、`test/server.test.js`，确认 `/api/health` 行为真实存在。
- 在同一 Repo 独立运行 `npm test`、`npm run typecheck`，并检查 Git diff 没有额外产品范围。
- 通过 `workspace_get_changes(since_version=3)` 复核 `agent.updated`、`execution.created/updated`、`change.updated` 等事件顺序。

WorkBuddy 完成后，Codex 再读取同一 Workspace 与 Git Repo，独立决定 Proof B 是否 PASS；在此之前不进入 Proof C。
