# My Whiteboard 0.2.0-alpha.3

My Whiteboard 是面向编码工作的 Agent-neutral 可视化 Workspace。它把流程图、逻辑图、结构图和代码架构图放进项目目录，让 Codex、WorkBuddy 和其他 MCP 客户端围绕同一份语义状态协作。

> Alpha 软件：请只使用非敏感测试内容。不要把密码、令牌、客户机密或受监管数据写进白板。

## 这版改变了什么

- `<project>/.my-whiteboard/workspace.json` 是唯一权威状态。
- Excalidraw 是可编辑的视觉投影，不是第二份实时数据库。
- Beta 5 SVG/JSON 只用于只读发现、迁移验证和必要回退。
- Workspace Version 负责 Event Log / Delta 顺序；Entity Version 负责对象级 optimistic concurrency。
- 独立 Web Workspace 通过短期令牌保护的 `127.0.0.1` URL 打开，不使用 iframe。
- Context、Tasks、Decisions、Artifacts、Agent Identity、Handoffs 和 Messages 与白板共用同一 Workspace。
- Supabase 是可选的跨设备副本；本地功能无需云端即可完整运行。

## 安装

从 GitHub Release/Tag 安装：

```sh
codex plugin marketplace add ontheoasis13/MyWhiteBoard --ref v0.2.0-alpha.3
codex plugin add my-whiteboard@my-whiteboard
```

或者克隆仓库后运行：

```powershell
./install.ps1 -Source .
```

安装或更新后请新建一个 Codex 线程，再试：

```text
使用 $whiteboard-design，在当前项目创建一张登录流程图并打开白板。
```

如果曾安装 `my-whiteboard@personal` 0.1，请先运行 `codex plugin remove my-whiteboard@personal`，避免 Codex 同时加载旧 Skill 和 0.2 插件。卸载命令需要在不占用旧插件的新线程或关闭 Codex 后执行。

## MCP 客户端

Codex 插件会自动注册 MCP Server。WorkBuddy 等客户端可把下列配置合并到自己的 MCP 配置中，并把路径改成实际安装位置。WorkBuddy 5.3.5 在 Windows 上读取 `%USERPROFILE%\.workbuddy\.mcp.json`：

```json
{
  "mcpServers": {
    "my-whiteboard": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/plugins/my-whiteboard/scripts/server.mjs"]
    }
  }
}
```

## 本地数据

每个项目的数据在 `<project>/.my-whiteboard/`：

- `workspace.json`：权威 Semantic Workspace
- `snapshots/`：本地版本快照
- `imports/`：Legacy 迁移副本
- `exports/`：JSON/SVG/PNG 输出
- `cloud.json`：不含令牌的云同步游标

临时 `lock` 文件不应提交。是否提交 `workspace.json` 由团队自行决定。

## 可选 Supabase 同步

已配置项目：`wketdxmdrdkmaryahnwk`。数据库迁移 `001` 保留 Beta 5 兼容表，`002`—`004` 新增 Semantic Workspace、RLS、Delta、对象级并发控制和 RPC 写入边界。

启动 Codex 前设置：

```text
SUPABASE_URL=https://wketdxmdrdkmaryahnwk.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable key>
MY_WHITEBOARD_SUPABASE_ACCESS_TOKEN=<signed-in user JWT>
```

`cloud_status`、`cloud_push`、`cloud_pull` 和 `cloud_get_changes` 只接受用户身份。Supabase Secret/Service Role Key 不得放入插件、浏览器、仓库或这些变量。详见 [Cloud Sync](docs/CLOUD_SYNC.md)。

## 验收状态

- 34 项自动测试通过
- Proof A 层级收敛后保留 15 个 Grounded Feature，并通过 Human Intent 重启/重扫持久化验证
- 38 个 MCP 工具烟雾测试通过；Proof B 已接入 Change Contract、Execution 生命周期与真实进程 Adapter
- 独立 Web Workspace 已完成真实浏览器检查，无 iframe
- Supabase 事务/RLS 契约已在目标项目用回滚测试验证
- Codex CLI 0.144.3 真实创建 Agent、Task 和 Handoff 成功
- WorkBuddy 5.3.5 已完成真实客户端闭环：Workspace v9、Handoff v2/accepted、Message 已回传，并通过 `mcp__my-whiteboard__workspace_get` 完成标准 MCP Transport 工具直调

测试指南见 [BETA_TESTING.md](BETA_TESTING.md)，发布前检查见 [PUBLIC_BETA_CHECKLIST.md](PUBLIC_BETA_CHECKLIST.md)。

## License

MIT，见 [LICENSE](LICENSE)。
