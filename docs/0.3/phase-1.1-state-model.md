# Phase 1.1 — State Model Boundary

状态：`PASS`

这是一个最小模型修正，不扩展产品范围，也不修改 Proof A / B / C 结论。

## Feature Actionability

Feature 的持久化语义状态只有：

`UNDERSTOOD`、`GROUNDED`、`ACTIONABLE`

旧 workspace 中遗留的 `EXECUTABLE` 会在读取/formalize 时降级为 `ACTIONABLE`，不会继续作为 Feature 状态写回。Human Intent 的旧 actionability patch 同样会被规范化，Human Intent 不承担永久执行权限。

## Execution Readiness

Change / Execution 层通过 `deriveExecutionReadiness` 派生：

- `READY`
- `BLOCKED`

当前支持的 reason code 包括 `CHANGE_NOT_APPROVED`、`REPO_SNAPSHOT_STALE`、`DIRTY_WORKSPACE_NEEDS_ISOLATION`、`NO_COMPATIBLE_AGENT`、`AGENT_OFFLINE` 和 `FEATURE_NOT_ACTIONABLE`。

`EXECUTABLE` 仅作为 API/UI 派生标签：Feature 为 `ACTIONABLE`，Change 已 approved，Repo safety ready，且存在兼容 Agent 时才返回该标签。

本阶段没有新增 Agent Adapter、Safe Execution 或 Phase 2 UI。

## 验证

- Feature 三态与旧 `EXECUTABLE` 迁移覆盖测试。
- READY / BLOCKED 及 reason code 覆盖测试。
- 旧 Phase 1 workspace 兼容读取保持通过。
- tests、typecheck、build、42-tool MCP smoke 均通过。
