# My Whiteboard 0.2 Alpha Testing Guide

测试时只使用非敏感示例数据。安装/更新后必须新建 Codex 线程。

## A. 安装与启动

- [ ] `codex plugin add my-whiteboard@my-whiteboard` 成功
- [ ] 新线程能识别 `$whiteboard-design`
- [ ] `project_create` 在项目中创建 `.my-whiteboard/workspace.json`
- [ ] `workspace_open` 返回 `127.0.0.1` 直连 URL
- [ ] 页面正常显示，浏览器中没有 iframe 和外部字体请求

## B. Semantic Board

- [ ] 创建流程图、结构图或 wireframe
- [ ] 在 Excalidraw 中移动/编辑对象后，`board_get` 返回更新后的语义字段
- [ ] 同一对象用旧 `expected_version` 更新会收到冲突
- [ ] 两个无关对象可分别更新，不发生全局冲突
- [ ] JSON/SVG/PNG 导出成功

## C. Workspace

- [ ] Context、Task、Decision、Artifact 可以创建和更新
- [ ] Agent Identity 被记录并能刷新
- [ ] `workspace_get_changes` 只返回游标后的事件
- [ ] Handoff 能由接收 Agent 接受/完成
- [ ] Messages 能按 Agent、channel 和版本游标过滤

## D. Beta 5 迁移

- [ ] `legacy_discover` 能找到旧文件
- [ ] `legacy_import` 生成 Semantic Board
- [ ] 第二次导入按 source hash 幂等跳过
- [ ] 旧 `.codex/whiteboards` 文件内容和时间戳未被修改

## E. 可选云同步

- [ ] `cloud_status` 不泄露 JWT 或 Secret Key
- [ ] 电脑 A `cloud_push` 后，电脑 B 的空 Workspace 可 `cloud_pull`
- [ ] 云端两个无关 Entity 可并发更新
- [ ] 同一 Entity 的旧版本更新被拒绝
- [ ] 未推送的本地修改存在时，`cloud_pull` 拒绝覆盖
- [ ] 登出或无 JWT 时无法读取私有 Workspace

## F. 真实客户端

- [ ] Codex CLI 连接 MCP、创建 Agent/Task/Handoff
- [x] WorkBuddy 真实客户端接受 Handoff、回传 Message
- [x] WorkBuddy 信任 `my-whiteboard` 后通过 MCP Tool 完成读取，不使用核心模块直调
- [ ] 两个客户端看到相同 Entity Version 和最终状态

## 报告问题

在 <https://github.com/ontheoasis13/MyWhiteBoard/issues> 提交：OS、Codex/WorkBuddy 版本、插件版本、复现步骤、期望/实际结果，以及去除隐私的截图。不要提交访问令牌、API Key、确认邮件链接或真实项目内容。
