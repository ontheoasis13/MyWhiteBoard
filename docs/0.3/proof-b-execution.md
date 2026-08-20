# Proof B — Execution

状态：`PASS`

进入条件：Proof A 明确 `PASS`，且用户批准继续。

目标：证明 Whiteboard 中被接受的 Change 可以通过 Agent-neutral 边界驱动真实 Agent 修改真实 Repo，并留下可追溯的 Change / Execution 状态、输入、输出与失败信息。

本阶段不以复制 Prompt、fake provider、mock agent 或客户端私有 Core 调用冒充通过。详细设计在 Proof A Gate 之后冻结。

## 当前实现

Proof A 的层级修正已在独立提交 `637c7b4` 完成，并保留原始 Proof A 提交 `cd26a62` 不变。随后建立了一个不绑定客户端名称的 Agent Execution Bridge：

- `Change Contract` 持久化在 Semantic Workspace 的 `changes` 集合；只有 `approved` 的 Change 可以执行。
- `Execution` 持久化在 `executions` 集合，记录 `changeId`、`agentId`、Adapter、输入、输出、错误、生命周期、仓库执行前后快照和文件变更。
- `ProcessAgentExecutionAdapter` 通过显式配置的真实进程传递 `Change ID`、`Execution ID`、Contract 文件路径和 Repo Root，并捕获 `queued → running → completed / interrupted / failed`。
- `execution_stop` 和 `execution_resume` 保留中断状态，并通过 `parentExecutionId` 建立续跑链路。
- `execution_claim` 允许已经运行中的外部 MCP Agent Host 接手 approved Change；`execution_report` 允许该 Host 报告 `running / interrupted / failed / completed / cancelled`，并由 MCP 边界捕获 Repo 执行后证据。
- 0.2 Workspace 读取时会补齐新集合，旧工作区不需要破坏式迁移；首次写入后新状态持久化到同一份 `workspace.json` 与 Event Log。
- MCP 新增 `change_create`、`change_get`、`execution_capabilities`、`execution_start`、`execution_claim`、`execution_report`、`execution_get`、`execution_stop`、`execution_resume`，当前工具总数为 40。

## 已通过的本地技术门禁

真实子进程测试已在临时 Git Repo 中通过：

1. 一个独立 Node 进程收到持久化 Change Contract，实际修改 `README.md`；Execution 完成后留下 lifecycle、stdout、Repo revision 和文件变更证据。
2. 一个长运行独立进程被 stop，Execution 进入 `interrupted`；随后 resume 产生新的、带 `parentExecutionId` 的 Execution。
3. JSON-RPC MCP smoke 通过同一套新工具创建 approved Change、启动真实 Node 进程、轮询状态并确认 `completed`。
4. JSON-RPC MCP smoke 通过 `execution_claim` / `execution_report` 验证外部 Host 接管路径，并确认 `changeId`、`executionId`、`agentId`、生命周期和 Repo 文件证据均持久化。

这些是 Agent Bridge / Persistence 的真实技术证据，但不把测试进程冒充 WorkBuddy，也不把本地测试进程计为最终 Proof B 通过。

## 真实 WorkBuddy 验收结果

WorkBuddy 已通过同一套 My Whiteboard MCP 完成真实 Hosted Execution：

- Workspace：`v3 → v8`；Delta 共 6 个有序事件。
- Agent：`proof-b-external-host`，WorkBuddy，Entity Version `2`。
- Change：`change-proof-b-health-endpoint`，最终 status `completed`，Entity Version `3`。
- Execution：`execution-eb0cbe4e`，adapter `hosted`，最终 status `completed`，Entity Version `3`。
- lifecycle：`queued → claimed → started → running → completed`。
- `repoBefore.revision` 与基线一致：`3550be483b271199f6a71f2a1b2407849cb34880`。
- MCP 捕获的 `repoChange.files` 恰为 `src/server.js`、`test/server.test.js`；revision 未被 WorkBuddy 提交，修改保持在工作区供独立核验。
- Codex 独立读取 Git diff，确认 `/api/status` 未变更、`/api/health` 与测试真实存在；`npm test` 为 2/2，`npm run typecheck` 通过。
- MCP Delta 顺序为：`agent.updated(v4)` → `execution.created(v5)` + `change.updated(v5)` → `execution.updated(running,v6)` → `execution.updated(completed,v7)` → `change.updated(completed,v8)`。

## 外部 Agent 验收边界

本机没有可由 Codex 进程直接启动的 `workbuddy` / `workbuddy-cli` 入口；本次验收由用户单独打开的真实 WorkBuddy 完成。WorkBuddy 通过已信任 MCP 连接调用 `agent_sync`、`change_get`、`execution_claim`、`execution_report`、`execution_get` 和 `workspace_get_changes`，未触碰 Core，也未由 Codex 模拟。

不以复制 Prompt、直接调用 Core、fake provider 或测试脚本替代这一步。最低兼容路径是让 WorkBuddy 在其 MCP Host 中调用 `execution_claim` / `execution_report`；若 WorkBuddy 不暴露该能力，则记录为 Adapter 能力缺口，而不是修改 Core 假装成功。

## 当前结论

Core、Persistence、MCP 边界、真实进程 Adapter、Hosted Execution 接管 API 以及真实 WorkBuddy Repo 修改证据均通过，Proof B 记为 `PASS`。Proof C 仍未开始。
