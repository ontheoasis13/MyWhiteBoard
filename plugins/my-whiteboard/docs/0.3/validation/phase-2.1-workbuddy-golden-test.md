# Phase 2.1 WorkBuddy Golden Test

## 当前状态

**TECHNICAL READY — REAL WORKBUDDY ACCEPTANCE PENDING**

Codex 完成了 Observation v2、Proposal boundary、Product View recovery UI、Board Node Inspector、runtime truth 与自动回归。Codex 无法打开 WorkBuddy，因此没有把 fixture 或 mock Agent 结果冒充真实 Golden Path。

## WorkBuddy 执行条件

1. 使用当前 `agent/v0.3-control-loop` checkout/runtime。
2. 新建全新的 `.my-whiteboard` workspace。
3. 使用全新 WorkBuddy session，不复用旧 Board，不手改 JSON，不调用 `board_apply` 补 Product Map。
4. 用户只发送：

   > 用 My Whiteboard 帮我理解 central-soe-content-workbench 这个项目。我不会看代码，我想知道这个软件主要有哪些功能，以及以后如果我要修改某个功能，应该从哪里开始。

## 预期 MCP 路径

`my_whiteboard_info → project_create → product_grounding_scan →（NEEDS_INTERPRETATION/PARTIAL 时由 WorkBuddy 解释 Evidence）→ product_structure_propose → workspace_open Product View`

不要自动 `code_board_create`，除非用户明确要求代码架构。

## WorkBuddy 需要回传的证据

- 实际调用的 MCP 工具全名与 Workspace Version
- fresh `product_grounding_scan` 的 observedFiles、Evidence、unmappedProductSignals、RepoSnapshot、understandingState
- Product Structure Proposal ID、baseRepoSnapshotId、agentId、groups/features/evidenceRefs、status=pending
- Human confirm/review/reject 结果与持久化 provenance
- Product View 中的 Product Map、Feature Inspector、stale proposal 提示
- Board View 点击 `server.js` 等 Code Node 后的 Node Inspector 截图/文字与相关 Product Feature 关系
- 是否发生自动 Code Board fallback（必须为否）

## Codex 独立复核

WorkBuddy 完成后，Codex 读取同一 Workspace 与 Git Repo，重新扫描 Repo，核对 Code Truth、Proposal provenance、Human Intent、RepoSnapshot freshness 和 Product View 状态，再决定 Golden Path 是否 PASS。
