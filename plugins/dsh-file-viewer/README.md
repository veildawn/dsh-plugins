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

装完确认 profile 的 `dsh.profile.bundles` 里有 `dsh-file-viewer`，否则插件不会加载。

## 使用

在会话标题栏右侧点击文件夹按钮，抽屉会从右侧滑出，并直接定位到本会话所在项目的工作目录。`Esc` 或点击抽屉外部关闭。

顶部可切换工作区、刷新、显示或隐藏点文件。目录在树中原地展开，子级首次展开时才加载。手机端抽屉占满全屏，文件列表与内容单列切换（左上角 `‹` 返回列表）。

## 访问边界

浏览范围限定在**已注册的工作区目录**与**各会话的工作目录**之内，可通过配置追加额外根目录：

```yaml
- id: file-viewer
  name: dsh-file-viewer
  config:
    extraRoots:
      - D:/Notes
    maxBytes: 20971520
```

每次请求都会先规范化路径，再用 `ctx.fs.contains` 校验目标落在某个已声明的根之内，因此 `..` 穿越与符号链接逃逸都会被拒绝。DSH 的文件系统沙箱只约束写入（读取默认放行），所以这层校验由本插件自己负责。

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
