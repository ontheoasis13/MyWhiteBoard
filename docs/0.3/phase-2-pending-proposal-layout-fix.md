# My Whiteboard 0.3 — Pending Proposal Layout Fix

状态：**PASS**（Phase 2 完成，Phase 3 不进入）

## 基线与实现

- 基线 HEAD：`3e926b7`
- 实现 HEAD：`91e4da0`
- 分支：`agent/v0.3-control-loop`

## 根因

`global-proposal` 是 `.product-shell` 的直接子节点，但没有显式 grid placement。CSS Grid 自动把它放进了第一个可用单元格，也就是左侧 `.product-sidebar` 列（约 228px），导致中文标题和说明被压成极窄竖排，CTA 与正文错位。

## 精确位置与最小修复

文件：`plugins/my-whiteboard/apps/workspace/src/styles.css`

```css
.global-proposal {
  grid-column: 2;
  grid-row: 2;
  min-width: 0;
  align-self: start;
  margin: 10px 22px 0;
}
.proposal-card > div:first-child { min-width: 0; flex: 1 1 320px; }
.proposal-actions { flex: 0 0 auto; white-space: nowrap; }
```

这保留了现有 DOM 和业务逻辑，只修正 Proposal 卡片的 grid ownership；没有修改 lifecycle、freshness、Grounding、ProductModel、MCP 或 human-only approval boundary。

## 浏览器验收

使用真实 served workspace 和新建 pending proposal：

### 默认桌面视口 1280px

- Product Main：`x=229, width=732`
- Proposal：`x=251, width=688, height=60`
- Proposal 宽度为 Product Main 的约 94%，超过 70% 门槛
- CTA：`x=698, width=225`，仍在卡片边界内
- sidebar 与 inspector 保持原列宽，没有被 Proposal 挤压

### 窄桌面视口 1024px

- Product Main：`width=552`
- Proposal：`width=508, height=88`
- 标题变为正常两行，而不是字符级竖排
- 三个 CTA 保持可见，且未溢出主内容区

截图：

- [Pending — desktop](evidence/screenshots/phase2-pending-proposal-layout/pending-desktop.png)
- [Pending — narrow desktop](evidence/screenshots/phase2-pending-proposal-layout/pending-narrow.png)
- [Confirmed after approval](evidence/screenshots/phase2-pending-proposal-layout/confirmed.png)

点击“确认这组结构”后复核：Proposal 卡片消失、Product Map 保留、生命周期进入 `CONFIRMED`，State Coherence 行为不受影响。

## 回归覆盖

新增：`plugins/my-whiteboard/tests/phase2-pending-proposal-layout.test.mjs`

该测试锁定：

- `global-proposal` 使用 Product Main grid column/row
- 主文案区域允许弹性收缩
- CTA 保持单行并且不溢出
- 不再使用旧的 sidebar 偏移 `270px`

## Gate

- `npm test`：74/74 PASS
- `npm run typecheck`：PASS
- `npm run build`：PASS，served assets 已更新
- MCP smoke：PASS，46 tools
- State Coherence T1–T6：全部通过
- Repo：证据提交后保持 clean
- Phase 3：**HOLD / 不进入**

