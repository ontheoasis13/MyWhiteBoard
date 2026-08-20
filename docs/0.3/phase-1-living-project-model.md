# Phase 1 — Living Project Model v1

状态：`PASS`

Proof A / B / C 均保持 `PASS`。Phase 1 正式化了 ProjectModel、Evidence、Human Intent、RepoSnapshot、Product Map Projection，以及 Feature Actionability Gate；Change / Execution 循环保持不变。

## 正式模型

- `Feature`：保留独立 semantic identity、hierarchy、grounding refs、Human Intent 和三态 actionability。
- `Evidence`：在兼容 `type / source / target / certainty` 的基础上统一增加 `evidenceVersion`、`kind`、`status`、`repoSnapshotId` 和 `provenance`。
- `HumanIntent`：独立持久化名称、层级、分组等人工纠偏；扫描不会覆盖这些意图，也不把它当作永久执行许可。
- `RepoSnapshot`：统一使用 `headRevision`、`dirty`、`workingTreeFingerprint`、`changedFiles`、`capturedAt`。
- `Product Map Projection`：从 Living ProjectModel 投影；`visualLayout` 单独保存，默认不参与语义扫描与层级推断。
- `Change` / `Execution`：保留现有循环，仅将执行前后 Repo 证据扩展为统一 RepoSnapshot 形状。

## Actionability Gate v1

Feature 只使用：

`UNDERSTOOD → GROUNDED → ACTIONABLE`

- `UNDERSTOOD`：Feature 概念已识别，但没有足够 Grounding。
- `GROUNDED`：存在真实 Evidence，但 Evidence 可能与当前 RepoSnapshot 不一致或不足。
- `ACTIONABLE`：Grounding 与当前 RepoSnapshot 匹配，证据足以进入 Change Planning。

执行可用性属于 Change / Execution 层的派生模型：`READY` 或 `BLOCKED`，并携带可解释 reason code。`EXECUTABLE` 只作为 UI / API 派生标签，不再作为 Feature 持久化语义状态。

## Gate 证据

- 旧 0.2 workspace / legacy board 读取回归通过。
- 旧 Product Model 可 formalize 为 `ProjectModel` v1，Evidence 与 Feature identity 保留。
- Human correction 的重启与重扫回归通过。
- HEAD 不变但 working tree 改变时，RepoSnapshot 的 `dirty / changedFiles / workingTreeFingerprint` 正确变化；未重新观察前 actionability 降为 `GROUNDED`。
- 重新扫描后 actionability 恢复为 `ACTIONABLE`。
- Product Map projection 保留 visual arrangement，不覆盖 semantic hierarchy。
- Proof A/B/C 回归仍通过。
- `npm test`：49/49；`npm run typecheck`：通过；`npm run build`：通过；MCP smoke：42 tools，通过。

Phase 1 完成后，Phase 2 Product-first UI、Visual Proposal、Impact UI、Execution Dashboard、Verification UI、User Flow、Tauri、Cloud expansion 和 Production deployment 均未开始。
