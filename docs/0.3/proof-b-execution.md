# Proof B — Execution

状态：`TECHNICAL READY — REAL WORKBUDDY ACCEPTANCE PENDING`

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

## 外部 Agent 验收边界

本机当前没有可由 Codex 进程直接启动的 `workbuddy` / `workbuddy-cli` 可执行入口；WorkBuddy 是独立的交互式客户端。因而当前状态明确为 `TECHNICAL READY — REAL WORKBUDDY ACCEPTANCE PENDING`，不是 `PASS`：还必须由真实 WorkBuddy 会话通过已信任的 MCP 连接消费一个 approved Change，调用 `execution_claim`，实际修改真实项目，再调用 `execution_report` 报告生命周期，最后由 Codex 通过 `execution_get` / `workspace_get_changes` 核对 lifecycle 与 Repo change。

不以复制 Prompt、直接调用 Core、fake provider 或测试脚本替代这一步。最低兼容路径是让 WorkBuddy 在其 MCP Host 中调用 `execution_claim` / `execution_report`；若 WorkBuddy 不暴露该能力，则记录为 Adapter 能力缺口，而不是修改 Core 假装成功。

## 当前结论

Core、Persistence、MCP 边界、真实进程 Adapter 和 Hosted Execution 接管 API 的技术证明通过；状态为 `TECHNICAL READY — REAL WORKBUDDY ACCEPTANCE PENDING`。Proof C 不提前开始。
