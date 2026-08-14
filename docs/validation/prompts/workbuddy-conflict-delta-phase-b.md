# My Whiteboard 0.2 — WorkBuddy Conflict / Delta Phase B

只通过 My Whiteboard MCP 执行以下操作，不读取 Core、`.my-whiteboard/workspace.json` 或 Codex 私人聊天：

1. 调用 `agent_sync`，身份为 `workbuddy-validation-agent`，`since_version=46`；读取 `conflict-delta-validation` 频道的 Phase B 消息。
2. 接受 Handoff `codex-to-workbuddy-conflict-delta`：`expected_version=1`，状态改为 `accepted`。
3. 将 Task `task-workbuddy-conflict-delta` 从 v1/todo 更新为 `in_progress`，使用 `expected_version=1`。
4. 调用 `workspace_get_changes(since_version=46)`，记录陈旧写入前的 Workspace Version 和事件数。
5. 对 Board `architecture-workbench` 调用 `board_apply`：
   - `op`: `update`
   - `id`: `acceptance-conflict-target`
   - `expectedVersion`: `2`（必须使用 Phase A 捕获的旧版本，不要先重读目标版本）
   - `patch.label`: `Conflict Target — WorkBuddy stale attempt must not persist`
6. 预期收到 `VERSION_CONFLICT`。不要改用最新版本重试，不要覆盖 Codex。
7. 立即再次调用 `workspace_get_changes(since_version=46)`，证明 Workspace Version 与事件数相较步骤 4 没有因为失败写入而增加，并确认 Delta 中没有该失败 label。
8. 更新无关元素 `acceptance-parallel-b`：
   - `op`: `update`
   - `id`: `acceptance-parallel-b`
   - `expectedVersion`: `2`
   - `patch.label`: `Parallel B — updated by WorkBuddy after stale conflict`
   该操作必须成功，使元素进入 v3。
9. 调用 `board_get`，确认：
   - `acceptance-conflict-target` 为 v3，label 仍是 `Conflict Target — Codex advanced after WorkBuddy snapshot`。
   - `acceptance-parallel-b` 为 v3，label 是 WorkBuddy 的成功更新。
10. 将 Task 从 v2/in_progress 更新为 v3/done；将 Handoff 从 v2/accepted 更新为 v3/completed，并写入完整完成摘要。
11. 向 Codex 发送 `response` 消息到 `conflict-delta-validation` 频道，引用 Task、Handoff 和 Board。
12. 最后调用 `workspace_get_changes(since_version=46)`，报告有序 Delta：事件版本、事件类型、实体 ID；明确指出失败写入没有事件。

结尾必须报告：实际 MCP 工具完整名称、最终 Workspace Version、Board Version、两个元素的最终版本/label、冲突错误码、失败前后 Workspace Version/事件数、Task/Handoff/Message 版本以及最终 Delta 明细。
