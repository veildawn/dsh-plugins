# dsh-file-viewer

在 DeepSeek Harness 里查看工作区文件：左侧目录树，右侧按格式渲染内容。

支持的格式：

| 格式 | 渲染方式 |
| --- | --- |
| 代码、配置、纯文本 | 语法高亮（复用 DSH 内置 shiki，26 种语言），带行号，按 500 行分页 |
| Markdown | 预览（GFM + 公式）与源码切换 |
| JSON | 可展开的结构树与源码切换 |
| 图片 | PNG、JPEG、GIF、WebP、AVIF、BMP、ICO、SVG |
| PDF | 交给浏览器内置阅读器（可搜索、翻页、缩放） |
| Excel | `.xlsx` / `.xlsm` / `.xls`，工作表标签 + 表格 |
| Word | `.docx`，转 Markdown 后渲染 |
| 其他二进制 | 显示文件信息，可用本地程序打开 |

## 安装

```bash
dsh plugin add --profile web <release-tgz-url>
dsh service restart
```

`dsh service restart` 依赖宿主打包的 systemd/launchd 单元；**`@deepseek-ai/dsh` CLI 本身没有
`service` 子命令**（`dsh --help` 只列出根命令、`web`、`plugin`），Windows 等没有那层封装的环境执行
会报 `error: too many arguments`。Windows 下改用本仓库的
[`scripts/dsh-service.ps1`](../../scripts/dsh-service.ps1)：

```powershell
powershell -File scripts/dsh-service.ps1 restart -Profile web
```

装完确认 profile 的 `dsh.profile.bundles` 里有 `dsh-file-viewer`，否则插件不会加载。

## 使用

- **会话中点击文件**：在会话回复（产物行、行内代码引用、工具调用摘要等）中点击任何文件路径，在远程访问模式或本地无法打开时，将自动唤起文件查看抽屉并直接选中预览该文件。
- **顶部工具栏**：在会话标题栏右侧点击文件夹按钮（移动端为右下角悬浮球），抽屉会从右侧滑出，并直接定位到本会话所在项目的工作目录。`Esc` 或点击抽屉外部关闭。

顶部可切换工作区、刷新、显示或隐藏点文件。目录在树中原地展开，子级首次展开时才加载。

文件树支持**右键上下文菜单**：
- **复制相对路径**：复制文件/目录相对于工作区根目录的路径；
- **复制绝对路径**：复制文件/目录在操作系统中的完整物理路径；
- **引用到输入框 (@)**：以 `@path` 格式将文件/目录直接插入当前会话的对话输入框。

手机端抽屉占满全屏，文件列表与内容单列切换（左上角 `‹` 返回列表）。

## 访问边界与安全访问路径

插件**内置可访问**所有**已注册的工作区目录**以及**各会话的工作目录**。

如需让文件查看器访问工作区以外的目录或磁盘，可通过配置**安全访问路径**（`safePaths`）放开指定路径的访问权限：

```yaml
- id: file-viewer
  name: dsh-file-viewer
  config:
    # 安全访问路径列表（支持字符串路径，或带展示标签的对象）
    safePaths:
      - /opt/data
      - /var/log
      # 支持自定义标签：
      # - path: /data/share
      #   label: 共享数据盘
      # Windows 示例：
      # - D:/Notes
    maxBytes: 20971520
```

配置后：
- 在文件查看器顶部的工作区下拉框中，将分组呈现「工作区」与「安全访问路径」，可直接切换浏览；
- 在对话回复或工具调用中点击属于安全访问路径内的文件路径时，文件查看器会自动定位并直接打开预览；
- 每次请求都会先规范化路径，再用 `ctx.fs.contains` 严格校验目标落在工作区或已配置的安全访问路径之内，严防 `..` 目录穿越与符号链接逃逸；
- 为保持向后兼容，原有的 `extraRoots` 与 `safeAccessPaths` 别名依然有效并会自动合并。

插件不注册任何 HTTP 路由，全部通过 `trusted-host` 权限的 RPC 通道通信，从而复用 DSH `/api` 的浏览器信任围栏（Host/Origin 校验、DNS rebinding 防护）。二进制文件经 RPC 取回后在浏览器侧生成 blob URL，默认单文件上限 20 MB。

## 已知限制

- 文件列表不显示修改时间：`ctx.fs` 的目录项只提供名称、类型与大小。
- 工作区需要手动选择：宿主端不存在"当前活跃工作区"的概念，该状态只在前端 UI 中。
- 大表格截断到 2000 行 × 64 列。
- Word 转换保留标题、强调、列表与表格，复杂排版与图片会降级。

## 开发

```bash
pnpm install
pnpm --filter dsh-file-viewer test
```
