# My Whiteboard 0.3 — Phase 2 State Coherence Fix

状态：**PASS**（Phase 3 继续 HOLD）

## 范围

本阶段只修复两个 P0：Product lifecycle 的状态分裂，以及 RepoSnapshot freshness 把“Feature actionability”误判为 stale。没有进入 Change Planning、Execution 或 Verification UI。

基线：`78cbc225815709def4db1ba9e63979bca0f31a75`

实现提交：`7092a52`（`fix(phase2): unify product lifecycle and repo freshness`）

## 根因与修正

### P0-1：生命周期统一

此前 API、Proposal 和 Product View 分别推导状态，导致 pending proposal 同时显示“等待 Agent 整理”和人工确认入口。新增 `deriveProductLifecycleState(...)`，统一输出：

- `NEEDS_INTERPRETATION`：Grounding 已完成，但没有可用 proposal/model。
- `PROPOSAL_PENDING`：存在 pending Product Structure Proposal，只显示人工确认、调整、拒绝入口。
- `CONFIRMED`：proposal 已由 authenticated UI 确认，ProductModel hierarchy 已应用并可通过 MCP 重读。

API、topbar、Product View banner、proposal CTA 和 `recommendedNextAction` 均从同一 derived lifecycle 读取。`EXECUTABLE` 仍不是 Feature 持久化状态。

确认后持久化 `understandingState=READY`、`recommendedNextAction=null`，并保留 proposal confirmation、group/feature `confirmedFromProposal` 证据。

### P0-2：freshness 修正

Freshness 现在只表示真实项目实现自上次 Grounding/RepoSnapshot 后是否改变：

- `.my-whiteboard/**` 被排除，不会因 My Whiteboard 自己写入状态而 stale。
- Git 项目使用 status；non-git 项目使用已观察源文件的 baseline hash 对比。
- HEAD 不变但源文件内容改变时，`changedFiles`、`dirty` 和 `changedSinceBaseline` 会标记 stale。
- `Feature.actionability=GROUNDED` 不再单独触发 freshness stale。

## 集成测试 T1–T6

| 测试 | 结果 | 证明 |
|---|---|---|
| T1 | PASS | NEEDS_INTERPRETATION 无确认 CTA、无 confirmed 文案 |
| T2 | PASS | pending proposal 显示等待人工确认与三项操作 |
| T3 | PASS | UI confirm 后 ProductModel、MCP reread、持久化 hierarchy 一致 |
| T4 | PASS | 写入 `.my-whiteboard` 后 freshness 仍为 CURRENT |
| T5 | PASS | non-git 真实源文件变化被识别为 STALE |
| T6 | PASS | GROUNDED Feature 不影响未变化 Repo 的 CURRENT freshness |

## 浏览器真实验收

使用独立临时 TS/JS Web 项目和实际 served workspace bundle：

- Case A：pending proposal，显示“产品结构等待你确认”、确认/调整/拒绝入口，freshness 为 CURRENT。
- Case B：点击“确认这组结构”后刷新，显示“产品结构已确认”，pending CTA 与 `PRODUCT_STRUCTURE_PROPOSAL` 消失，Product Map 保留。
- Case C：确认后追加真实 `server.js` 源代码，再打开页面，显示“检测到项目发生变化”和“需要重新理解实现依据”。

截图：

- [Case A — pending](evidence/screenshots/phase2-state-coherence/pending.png)
- [Case B — confirmed](evidence/screenshots/phase2-state-coherence/confirmed.png)
- [Case C — source change stale](evidence/screenshots/phase2-state-coherence/source-change-stale.png)

## MCP / 持久化证据

浏览器临时项目的实际持久化复核结果：

- `product-proposals.json`：proposal status=`confirmed`、version=`2`。
- `product-model.json`：`understandingState=READY`、`recommendedNextAction=null`，group 与 feature 均保留 `confirmedFromProposal`。
- `product_grounding_get` MCP reread：返回 `modelType=ProjectModel`、confirmed hierarchy；源文件改变后返回 `changedFiles=["server.js"]`。

结构化证据见 [`phase-2-state-coherence-fix-results.json`](evidence/phase-2-state-coherence-fix-results.json)。

## Gate

- `npm test`：73/73 PASS
- `npm run typecheck`：PASS
- `npm run build`：PASS，served assets 已更新
- MCP smoke：PASS，46 tools
- Repo：实现提交后 clean；证据提交完成后再次确认 clean
- Proof A / B / C：保持原结论，不修改历史
- Phase 3：**HOLD，不进入**

