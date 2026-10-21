# dsh-zcode-theme（已并入主题工作室）

> **⚠️ 本包已废弃。**
> ZCode 全平台视觉主题已迁入 **[@weniatall/dsh-theme-studio](https://www.npmjs.com/package/@weniatall/dsh-theme-studio)**，
> 作为它的两款内置主题：`zcode`（官方）与 `zcode-mono`（单色极简）。
>
> 新包还提供苹果玻璃主题，以及背景 / 字体 / 字号 / 字段颜色的可视化自定义。

## 迁移

```bash
dsh plugin --profile web remove @weniatall/dsh-zcode-theme
dsh plugin --profile web add @weniatall/dsh-theme-studio
```

迁移后打开「设置 → 主题工作室」即可切换主题与调整外观。

## 这个包现在是什么

一个**兼容薄壳**，只为两类用户存在：

1. **已安装旧版、尚未迁移**：升级到本版本后行为与旧版完全一致——同样的
   `data-dsh-theme="zcode"` 属性、同样的样式标签 id（`dsh-zcode-theme`）、
   同样的配色。不会因为包被废弃而白屏。
2. **同时装了新旧两个包**：薄壳产出的变量与主题工作室的 ZCode 主题**逐值相同**
   （同一份 token 与 CSS 源），所以两者不会打架。薄壳客户端检测到
   `data-theme-studio` 时会让位，不抢属性。

## 薄壳做了什么

| 旧版行为 | 现在 |
| :--- | :--- |
| 自带 15 份 CSS 与 202 项色板 | **删除**，改用 `@weniatall/dsh-theme-studio` 的产物 |
| 注入 `data-dsh-theme="zcode"` | 保留（值、标签 id 完全不变） |
| 客户端内联 130 项 `HOST_TOKEN_MAP` | **删除**，配色改由服务端注入的 CSS 变量提供 |
| 客户端调用 `ctx.theme.overrideTokens()` | **移除**——这是与主题工作室冲突的根源 |
| — | 新增：检测到 `data-theme-studio` 时让位；启动时打印一次迁移提示 |

为什么移除 `overrideTokens`：两个插件各注册一层覆盖，后注册的那层覆盖前一层。
用户切到玻璃主题后，旧插件的内联 style 仍然压在 `body` 上，玻璃主题的颜色被
**静默盖掉**——这是最难排查的一类问题，没有报错、没有日志。

## 依赖

`@weniatall/dsh-theme-studio` 是 `dependencies`。装本壳会自动带上主题工作室，
所以「薄壳」不会退化成一份需要单独维护的 CSS 副本。

## 重启生效

- **macOS / Linux**：`./scripts/dsh-web.sh restart`
- **Windows**：`.\scripts\dsh-web.ps1 restart` 或 `scripts/dsh-web.cmd restart`

## License

MIT
