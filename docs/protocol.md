# 协议与数据

[返回项目首页](../README.md)

## 消息与版本

Session Protocol 使用 JSON-RPC 2.0，与传输分离。桌面通过 Main 与 Utility Process 的私有 IPC 转发，没有对外 WebSocket 服务。请求携带 `id`、`method`、`params`，响应使用相同 ID；活动以 `event` notification 传递，参数为 EventEnvelope。

方法包括原有集合与 1.1 桌面增补，名称和校验以 `packages/protocol/src/schemas.ts`、Worker 路由及生成 Schema 为准。方法名不代表某种传输已实现完整服务。

| 方法组                 | 用途                               |
| ---------------------- | ---------------------------------- |
| `workspace.*`          | 创建、打开、列出、读取、保存、导出 |
| `provider.*`           | 配置、状态、能力检测               |
| `session.*`            | 创建、读取、列表、恢复、取消       |
| `turn.*`、`task.retry` | 启动、追加要求、中断、手动重试     |
| `proposal.*`           | 读取、审批、拒绝、调整             |
| `revision.*`           | 版本列表、反向候选                 |
| `event.subscribe`      | 连续事件历史                       |

Session、事件、能力、Permission、ChangeSet、Revision、Manifest 和作品格式独立版本化。字段不能更换已发布语义；兼容增补应为可选，破坏性变更需要新版本和迁移说明。TypeBox 确定性生成 Draft 2020-12，使用 Ajv 2020 校验。

## 作品布局

```text
story.yaml                  名称与创作约定
NOVEL.md                    可选作品指令
manuscript/                 正文
outline/                    大纲与场景计划
canon/                      人物、地点、时间线、伏笔
skills/                     可读规则文档
.novel-agent/config.toml     可移植作品标识
.novel-agent/               本地账本、对象和候选
```

`story.yaml` 使用 `schemaVersion: 1`，名称为 `title`。表单读取可选 `creativeBrief` 映射，字段 `genre`、`viewpoint`、`protagonistGoal`、`worldRules`、`style`、`boundaries` 均为字符串。保留未知字段和注释，不兼容类型由文本编辑处理，不自动迁移。桌面模型设置独立于作品配置，CLI 初始化的 Mock 标记不触发桌面 Mock 模型。

## 候选与修订

ChangeSet 携带相对路径、精确基线和结果 hash、说明、范围、风险与证据。审批绑定候选和基线，冲突保留当前正文。每份桌面候选修改一个文件，批量生成多份单文件候选，不提供跨文件原子提交。

Revision 保存前序、内容 hash 和审批关系且不可变。Undo 创建反向候选。契约中的预算字段不表示已实现完整货币结算。

## 敏感数据

EventEnvelope 保存 ID、流、连续序列、类型、时间、actor、关联信息、可见性与 payload。事件只追加，回放不调用模型或发布文件，未知事件不改写含义。

账本可包含用户消息、模型回复、计划和来源，因此可能含私人稿件。`visibility: "secret"` 也不允许凭据；API Key、令牌、隐藏推理和未脱敏 Provider 原始负载禁止持久化。

正文导出不能重建任务和审批历史。复制完整作品前退出客户端并妥善处理运行数据，仅迁移正文不等于会话迁移。
