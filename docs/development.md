# 开发与验证

[返回项目首页](../README.md)

## 环境和运行

主要桌面平台为 Windows x64。准备 Git、Node.js 22 或更新版本、pnpm 11.8.0，使用提交的锁文件：

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm desktop:prepare
pnpm desktop:build
pnpm desktop:start
```

Electron 未下载时先运行 `node apps/desktop/node_modules/electron/install.js`。准备脚本校验并复制 better-sqlite3 包自带的平台 Node-API 二进制；缺失时明确失败。Node 测试使用包自身绑定。启动脚本只运行现有构建，源码更改后需重新构建并关闭旧窗口。

## 目录

| 目录                   | 职责                                   |
| ---------------------- | -------------------------------------- |
| `apps/desktop`         | Main、Preload、Worker、React 编辑界面  |
| `apps/cli`             | 显式 Mock 工作流示例                   |
| `packages/kernel`      | 文件、模型、权限、工具循环、候选和修订 |
| `packages/event-store` | 回放与 SQLite 账本                     |
| `packages/protocol`    | 契约、校验、能力策略与生成 Schema      |
| `examples`             | 合成示例                               |
| `scripts`              | Windows 启动                           |

## 验证

```powershell
pnpm check
pnpm desktop:prepare
pnpm desktop:build
pnpm desktop:test
```

`pnpm check` 包含格式、Schema 生成一致性、严格类型和测试。桌面测试使用 Electron、临时作品和本地 HTTP 模型夹具，不需要真实 API Key。CI 在 Linux/Windows 执行核心检查，Windows 执行桌面准备、构建和测试；托管结果以 Actions 页面为准。

Schema 源码变化后运行 `pnpm schemas:generate`，提交生成结果。协议或边界变化需更新[协议](protocol.md)与[架构](architecture.md)，兼容旧版本，不重解释历史字段。

## CLI

CLI 使用显式 Mock 模型展示机制；真实创作使用桌面端。

```powershell
pnpm na init ./demo-story
pnpm na start ./demo-story --task "让开场出现一场突如其来的暴雨。"
pnpm na approve ./demo-story <session-id>
pnpm na resume ./demo-story <session-id>
```

## 数据

只用合成稿件和明显假凭据。勿提交真实作品、会话、数据库、桌面设置与原始 Provider 负载。真实测试使用自己的服务账户并承担费用。通过客户端输入密钥，不打印到日志或写入夹具；问题报告先脱敏。
