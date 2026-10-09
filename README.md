# dsh-openspec-dashboard

DeepSeek Harness 右侧栏 OpenSpec 看板，无需安装 OpenSpec CLI。仅支持 OpenSpec 标准默认模板，不支持自定义 schema/模板或外部 store。

## 功能

- **变更**：按「筹划 → 进行 → 完成 → 归档」展示；归档按日期前置的目录名倒序。可展开文件和任务，只有活动变更的任务复选框可写入。
- **规格**：合并当前规格与活动变更中的规格，按「新增 → 变更 → 确认」展示；展开可查看各变更来源和当前文件。
- 搜索同步过滤列表与顶部统计，零值省略；`openspec/` 文件变动后自动更新。任务写入经过会话权限与文件版本校验。

## 安装

直接从 [GitHub](https://github.com/vowdemon/dsh-openspec-dashboard) 安装，无需克隆或构建：

```sh
dsh plugin --profile desktop add github:vowdemon/dsh-openspec-dashboard#v0.0.1
```

独立的 `dsh web` 使用另一条命令：

```sh
dsh plugin --profile web add github:vowdemon/dsh-openspec-dashboard#v0.0.1
```

安装后从右侧栏“添加标签页”选择 **OpenSpec 看板**；Web 服务需重启并刷新页面。

开发时运行 `pnpm install --frozen-lockfile && pnpm run verify`，并提交生成的 `dist/index.js` 与 `dist/client.js`。
