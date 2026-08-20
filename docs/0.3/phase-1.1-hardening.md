# My Whiteboard 0.3 — Phase 1.1 Hardening

状态：`PASS`

本阶段只收紧 Phase 1 的状态边界与执行前置条件，没有改变 Proof A / B / C 的结论，也没有加入新的 Agent Adapter 或 Safe Execution 实现。

## Hardening Gate

| 项目 | 结果 |
| --- | --- |
| A1 动态 readiness 与授权分离 | `PASS` — `change_get` 只派生 readiness；`execution_start`、`execution_claim` 在提交前重新读取 Change、Feature、RepoSnapshot 与 Agent 能力。基线漂移会以 `REPO_SNAPSHOT_STALE` 拒绝。 |
| A2 多 blocker reason | `PASS` — reason code 去重并按稳定顺序返回，同时返回可解释的 `message`、`recoverable`、`suggestedAction`。 |
| A3 多目标 Change | `PASS` — `targetFeatureIds` 持久化；所有目标必须为 `ACTIONABLE`，缺失或非 actionable 的目标统一产生 `FEATURE_NOT_ACTIONABLE` 和目标 ID。 |
| A4 Group / Feature 边界 | `PASS` — Product Group 只有分组语义，不参与 actionability；Feature 的 `hidden` 只影响 Product Map Projection；节点显式标记 `nodeKind: group/feature`。 |
| A5 Agent 兼容性 | `PASS` — Agent presence 不再等同于执行兼容；Hosted Execution 需要 `hostedExecution`/`execution` 能力，Process Execution 以 adapter capability 重新检查。 |

## 兼容与持久化

- Feature 持久化 actionability 只有 `UNDERSTOOD`、`GROUNDED`、`ACTIONABLE`。旧数据中的 `EXECUTABLE` 读取时迁移为 `ACTIONABLE`，不作为永久权限。
- Execution Readiness 属于 Change / Execution 层，只有 `READY`、`BLOCKED` 两态；`EXECUTABLE` 仍可作为 UI/API 派生标签。
- 0.2 workspace、Board、MCP、Workspace、Agent、Handoff、legacy import 读取回归保持通过。
- Product Map 的拖动布局保存在 `visualLayout`，不会改变 Feature semantic version；Human correction 可以显式 revert，重扫后仍保留布局。

## 验证结果

- `npm test`：`56/56` 通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- MCP smoke：`42` tools，通过；未重新引入 iframe output template。
- Proof A / B / C 回归：通过（现有测试套件覆盖）。

详细机器可读证据见 [`evidence/phase-1-1-hardening-results.json`](evidence/phase-1-1-hardening-results.json)。
