# Phase 1 — Living Project Model v1

状态：`PASS`

基线：Proof A / B / C 均为 `PASS`；Phase 1 不改变三项 Technical Proof 的结论，也不进入 Phase 2。

## 正式模型

Phase 1 将现有 Proof 数据收敛为 `ProjectModel` v1：

- `Feature`：保留独立 semantic identity、hierarchy、grounding refs、Human Intent 和 actionability。
- `Evidence`：在原有 `type / source / target / certainty` 兼容字段上统一增加 `evidenceVersion`、`kind`、`status`、`repoSnapshotId` 和 `provenance`。
- `HumanIntent`：继续独立持久化，扫描不会覆盖人工名称、父子关系、分组或 actionability 许可。
- `RepoSnapshot`：统一使用 `headRevision`、`dirty`、`workingTreeFingerprint`、`changedFiles`、`capturedAt`。
- `Product Map Projection`：从 Living ProjectModel 投影；`visualLayout` 单独保存，默认不参与语义扫描与层级推断。
- `Change` / `Execution`：保留现有循环，仅将执行前后 Repo 证据扩展为同一 RepoSnapshot 形状。

实现位置：`plugins/my-whiteboard/core/project-model.mjs`，并接入现有 Product Grounding、Verification 和 Execution 路径；MCP 工具总数保持 42。

## Actionability Gate v1

使用可解释规则，不做评分：

`UNDERSTOOD → GROUNDED → ACTIONABLE → EXECUTABLE`

- `UNDERSTOOD`：Feature identity 尚未有确认 grounding。
- `GROUNDED`：存在确认 Evidence，但 Evidence 与当前 RepoSnapshot 不一致或尚未完成重新扫描。
- `ACTIONABLE`：确认 Evidence 与当前 RepoSnapshot 匹配，且 Feature 为 observed。
- `EXECUTABLE`：Human Intent 明确允许执行、RepoSnapshot clean，且 Feature 未隐藏。

## Gate 证据

- 旧 0.2 workspace / legacy board 读取回归通过。
- 旧 Product Model 可被 formalize 为 `ProjectModel` v1，Evidence 与 Feature identity 保留。
- Human correction 的重启与重扫回归通过。
- HEAD 不变但 working tree 改变时，RepoSnapshot 的 `dirty / changedFiles / workingTreeFingerprint` 正确变化；未重新观察前 actionability 降为 `GROUNDED`。
- 重新扫描后 actionability 恢复为 `ACTIONABLE`。
- Product Map projection 保留 visual arrangement，不覆盖 semantic hierarchy。
- Proof A/B/C 回归仍通过。
- `npm test`：49/49；`npm run typecheck`：通过；`npm run build`：通过；MCP smoke：42 tools，通过。

Phase 1 完成后暂停。Phase 2 Product-first UI、Visual Proposal、Impact UI、Execution Dashboard、Verification UI、User Flow、Tauri、Cloud expansion 和 Production deployment 均未开始。
