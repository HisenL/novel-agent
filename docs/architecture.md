# 架构

[返回项目首页](../README.md)

## 组件

项目使用 TypeScript 与 pnpm 工作区，桌面使用 Electron、React、Vite 和 CodeMirror。CLI 和桌面共享 Kernel 包中的文件、候选及事件机制，入口工作流不同。

```text
Renderer (React / CodeMirror)
    -> Preload 白名单桥接
    -> Main：发送方校验、文件对话框、安全存储
    -> Utility Process：Kernel / Model Adapter / Tool Loop
    -> FileBroker + SQLite Event Store
    -> 作者审批与文件发布
```

Renderer 启用 sandbox、contextIsolation、关闭 Node integration，只加载本地资源。Main 校验主窗口和主 Frame，阻止任意导航、新窗口与 Renderer 联网。模型经 Worker 的网络代理访问服务。Utility Process 不是任意代码安全沙箱。

## 内容与事件

接受后的 Markdown/YAML 字节是当前内容。事件账本保存任务、工具、候选、审批与修订的历史和因果，不能用旧投影静默覆盖现有文件。

每个流从序列 1 连续追加，回放拒绝缺口、重复、乱序和跨流事件。SQLite 使用 WAL、完整同步、唯一约束和显式事务。

## 执行循环

Kernel 组合约定、当前文件、有限相关文档与近期消息。模型选择列目录、读取、检索、规划、候选工具，结果送回模型，直至结果、候选、暂停、错误或调用上限。

探索与审稿的只读由 Kernel 限制工具。批量模式绑定文件范围和 hash，保留候选，触发停止条件时暂停；语义分岔识别依赖模型。技能是版本化声明式指令，不能增加权限或执行代码，任务恢复校验历史规则。

初始文档上下文约 24,000 字符，恢复最多八个近期读取路径，消息最多十二条。关键词检索扫描文件列表前 100 个文件，尚无分层摘要或向量记忆；长篇任务需缩小范围并核对来源。

## 发布与恢复

模型只创建候选。发布绑定 ChangeSet、base hash、结果 hash 和作者审批。FileBroker 校验相对路径，拒绝路径穿越、链接和非受管资源；授权使用展开后的精确能力 ID。

1. 核对当前 base hash。
2. 在目标同目录写入临时文件并同步落盘。
3. 追加 `revision.prepared` 和不可变 Revision。
4. 替换正式文件。
5. 追加 `revision.materialized`。

恢复时比较当前、基线与结果 hash，补完发布或记录冲突。Undo 创建反向 ChangeSet，经审批成为新修订。

## 模型与秘密

Provider 显式配置协议、地址、模型、调用与输出上限。外部服务要求 HTTPS，loopback 可用 HTTP，拒绝重定向。OpenAI 官方地址使用 Responses、`store: false` 和自定义函数工具。

Main 使用 Electron 异步 safeStorage 加密密钥，Kernel 为单次操作取得凭据。Renderer 不接收已存储的明文密钥。凭据不进入事件或导出，安全存储不可用则拒绝保存。

费用使用返回 Token 数与当时配置的可选单价估算，缺失信息标记未知。调用上限不等于完整货币预算预占，失败请求也可能收费。

## 范围

没有社区可执行插件宿主、MCP 接入、网络服务端或自动更新。Manifest Schema 不代表已实现插件运行能力。安全边界见[威胁模型](security/threat-model.md)。
