# dsh-openspec-dashboard

DeepSeek Harness 右侧栏 OpenSpec 看板，无需安装 OpenSpec CLI。仅支持 OpenSpec 标准默认模板，不支持自定义 schema/模板或外部 store。

## 功能

- **变更**：按「筹划 → 进行 → 完成 → 归档」展示；归档按日期前置的目录名倒序。可展开文件和任务，只有活动变更的任务复选框可写入。
- **规格**：合并当前规格与活动变更中的规格，按「新增 → 变更 → 确认」展示；展开可查看各变更来源和当前文件。
- 搜索同步过滤列表与顶部统计，零值省略；`openspec/` 文件变动后自动更新。任务写入经过会话权限与文件版本校验。
- 看板内切换「变更／规格」时，分别保留搜索词、列表滚动位置（变更按活动／归档／全部区分）、条目展开与变更内的文件／任务、仅看未完成及分组折叠；仍存在的条目在自动更新后保持这些浏览选择。状态按会话与工作区隔离，仅在当前看板实例存活期间保留；新会话不继承其他会话的选择，页面重载或插件重启后不保证恢复，任务写入中和错误提示不属于保留状态。
- 看板不对目录深度、变更、规格、Markdown 文件或任务行数另设固定截断；可访问的大型任务文件也可按权限编辑。底层目录服务自行截断的结果不另行提示。
- 自动更新连接失败或监听不可用时，标题同行显示“更新失效”（英文为 “Updates unavailable”）；内容仍可浏览，连接确认恢复后提示消失。
- 右侧栏标签与“添加标签页”入口均显示文档／任务勾选图标及本地化名称，窄侧栏下文字可省略显示，图标保持可见。

## 安装

直接从 [GitHub](https://github.com/vowdemon/dsh-openspec-dashboard) 安装，无需克隆或构建：

```sh
dsh plugin --profile desktop add github:vowdemon/dsh-openspec-dashboard
```

独立的 `dsh web` 使用另一条命令：

```sh
dsh plugin --profile web add github:vowdemon/dsh-openspec-dashboard
```

安装后从右侧栏“添加标签页”选择 **OpenSpec 看板**；Web 服务需重启并刷新页面。
