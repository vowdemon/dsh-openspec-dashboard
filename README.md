# OpenSpec 看板

**简体中文** | [English](./README.en.md)

在 DeepSeek Harness 的右侧栏查看当前项目的 OpenSpec 变更、规格和待办任务。

## 你可以做什么

- **掌握变更进展**：查看筹划中、进行中、已完成和已归档的变更，展开查看相关文件与任务。
- **处理待办**：在活动变更中勾选已完成的任务，或选择“仅看未完成”，专注眼下要做的事。
- **查找规格**：浏览当前规格及其变更来源，点击文件即可在 DeepSeek Harness 中打开。
- **随时接着看**：搜索、切换变更和规格，或返回先前的列表时，看板会保留当前会话的筛选、展开项和滚动位置。项目文件发生变化时，内容会自动更新。

## 安装与使用

桌面版 DeepSeek Harness：

```sh
dsh plugin --profile desktop add github:vowdemon/dsh-openspec-dashboard
```

使用独立的 `dsh web`：

```sh
dsh plugin --profile web add github:vowdemon/dsh-openspec-dashboard
```

打开包含 `openspec/` 目录的项目，在右侧栏点击“添加标签页”，选择 **OpenSpec 看板**。使用 `dsh web` 时，安装插件后需重启 Web 服务并刷新页面。

> 目前支持标准 OpenSpec 项目；自定义模板或外部 store 暂不支持。已归档变更的任务不可勾选。看板的浏览位置不会在页面重载后保留；如果自动更新暂时不可用，标题旁会显示“更新失效”，现有内容仍可查看。

## 演示截图

![变更文件视图](./screenshots/demo_1.png)

![变更任务视图](./screenshots/demo_2.png)
