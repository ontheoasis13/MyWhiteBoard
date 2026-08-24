# My Whiteboard 0.3 — Phase 3 Technical Delta Implementation

## 基线与范围

- 基线分支：`agent/v0.3-control-loop`
- 开工基线：`7ae485ea48c8f6738971e62097de73e294677e12`
- 本次实现严格依据 Phase 3 Kickoff、Design Freeze 与 Technical Delta Design；未发现需要改变冻结架构的代码冲突。
- 本阶段只实现状态、证据、Product Structure、MCP/HTTP/UI 的最小技术闭环，不引入内置 Agent、LLM、编排器、聊天镜像或完整执行平台。

## 已实现

### Development State

- 在既有 `Change` 上增加可选 `development` 快照，不新增实体。
- 支持 `IN_PROGRESS`、`WAITING_FOR_USER`、`VERIFYING`、`READY_FOR_REVIEW`、`ACCEPTED`、`PAUSED`。
- `event_id` 幂等写入；重复事件在版本校验前返回已存在结果；新的过期写入返回 `VERSION_CONFLICT`。
- Development 状态与 Agent presence/lifecycle 分离；无可信适配器信号时连接状态为 `UNKNOWN`。
- 结果保留 `AGENT_REPORTED`、`OBSERVED`、`HUMAN_REPORTED_VIA_AGENT`、`HUMAN_CONFIRMED_IN_UI` 来源，不以 Agent 的 done 文本冒充事实。

### Product Structure 与 Evidence

- 支持 `PLANNED_INTENT` 与 `OBSERVED_EVIDENCE` 两种 Product Structure basis。
- Planned proposal 可在没有 Evidence 时建立，能在 Repo 漂移后保持，并在确认后落入正常 Feature（`productState=planned`、`UNDERSTOOD`）。
- Product Map 的“未分组”是 presentation-only 虚拟分组，不写入语义层；人工选择该项会持久化为空 `groupId`。
- Agent-reported implementation evidence 先从当前 RepoSnapshot 重新观察，再以 `OBSERVED` 物理来源与 `AGENT_REPORTED` 语义关联写入。

### API 与界面

- MCP 新增：`development_context_get`、`development_start`、`development_update`、`development_result`。
- `my_whiteboard_info` 暴露 development/milestone/cross-agent/planned-structure 能力。
- HTTP 新增开发上下文读取与 UI 确认入口：`GET /api/session/development`、`GET /api/session/development/:changeId`、`POST /api/session/development/:changeId/accept`。
- Workspace 使用中文 Development 视图；Product View 顶部显示当前开发摘要；Change 变更列表作为开发上下文入口。

## 验证结果

- `npm test`：76/76 通过
- `npm run typecheck`：通过
- `npm run build`：通过
- MCP smoke：通过，当前工具数 50
- `git diff --check`：通过

外部 Agent 的 Golden A–H 验收仍需在真实客户端中执行；本文件不将本地自动化结果升级为外部 Agent 验收结论。
