# koishi-plugin-yesimbot-memory-panel

> ⚠️ **全AI制作** · 本项目由 AI 全流程生成，未经充分人工测试，存在很多问题，请注意使用、谨慎评估后再部署到生产环境。

YesImBot 记忆可视化面板：核心人格 / 三级记忆 / 记忆体检 / 注入联调 / 行为学习。

通过 Koishi 控制台内嵌页面，直观查看 YesImBot 的长期记忆体系，并排查"为什么这样回答"。

## 功能

- **核心人格**：展示 YesImBot 注入上下文的全部人格块，与 Agent 心跳注入使用同一公开方法（`getMemoryBlocksForRendering`）。
- **三级记忆**：
  - **L1 工作记忆**：频道最近对话流（消息 + Agent 思考/动作/观察），走 `l1_manager.getL1History`。
  - **L2 语义记忆**：关键词检索记忆块，走 `l2_manager.search`（向量相似度 + 邻居扩展）；无可用嵌入模型时自动降级为关键词模拟并明示。
  - **L3 日记**：按日历查看长期日记（`worldstate.l3_diaries` 表直读）。
- **记忆体检**：表统计（行数/容量）、按频道三级分布、L2 向量维度、范围清理（带行数护栏与二次确认）。
- **注入联调**：输入一句话，模拟查看将注入的 L2 片段 + L1 上下文 + 人格块组合（独立调用与真实注入同源的公开函数，结果仅供参考）。
- **行为学习**：展示行为学习器（yesimbot-behavior-learner）的待确认候选、行为文档（behavior.md）与采纳率统计（只读视图，零插件间依赖）。

## 安装

```sh
npm i koishi-plugin-yesimbot-memory-panel
```

在 Koishi 控制台的插件市场中搜索"yesimbot-memory-panel"安装，或手动在配置中加入：

```yaml
plugins:
  yesimbot-memory-panel:
    # l1PreviewLimit: 80    # L1 历史预览最大条数
    # l2PreviewK: 5         # L2 语义检索 Top-K
    # cleanupMaxRows: 500   # 单次清理最多删除行数（护栏）
    # timezone: Asia/Shanghai  # 清理与时间过滤的时区（容器为 UTC 时必须设置）
    # cleanupToken: ''      # 清理接口访问令牌（设置后前端清理需输入；面板无 Koishi 鉴权，建议内网部署时配置）
```

## 使用

安装并启动后，在 Koishi 控制台左侧菜单点击 **YesImBot 记忆** 进入面板。

面板挂载地址（可直接访问）：

```
http://<host>:<port>/__yesimbot-memory-panel-ui/
```

> 旧地址 `/yesimbot-memory-panel/` 保留 302 重定向，兼容历史收藏。

## 依赖

| 服务 | 类型 | 说明 |
| --- | --- | --- |
| `console` | 必填 | 控制台集成（iframe 壳） |
| `server` | 必填 | REST 路由与静态页 |
| `database` | 可选 | 记忆表直读（L1/L2/L3/体检/清理） |
| `yesimbot.world-state` | 可选 | L1/L2 真实注入同源检索 |
| `yesimbot.memory` | 可选 | 人格块真实注入同源读取 |

任一可选服务缺失时对应模块自动降级并在前端标注，不影响其余功能。
