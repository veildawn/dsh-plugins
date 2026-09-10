# ZCode 移动端风格主题设计规范与规划方案 (dsh-zcode-theme)

> **目标**：以官方 ZCode 桌面及手机端 (Remote Control) 的视觉语言为基准，为 DeepSeek Harness (DSH) Web 规划并构建一套沉浸式暗色极简主题。
> **定位**：正交于布局适配器 `dsh-mobile-adapter`。本插件负责 **色彩系统、材质质感、组件表面样式**；布局、抽屉结构、安全区视口自适应仍由 `dsh-mobile-adapter` 承载。

---

## 一、 视觉语言与设计原则 (Visual Language)

结合 ZCode 产品界面（深炭微噪底色、橙红品牌高亮、极简线框、高圆角卡片）提炼出 8 条核心设计原则：

1. **深炭画布底色 (Deep Charcoal Canvas)**：
   摒弃纯黑（#000000）或蓝黑偏色（如 GitHub Dark 的 #0d1117），主背景使用中性偏暖的 `#1A1A1A`，卡片与二级面板使用 `#222222`，输入与提升层使用 `#2A2A2A`。
2. **暖橙红单一强调色 (Warm Vermilion Accent)**：
   全站主操作色统一为 ZCode 标志性的暖橙红 `#E85D3A`（悬浮态 `#F06A48`，按压态 `#D14F2E`），彻底替代 DSH 宿主默认的深蓝 `#4d6bfe`。
3. **低侵入选中态 (Subtle Selection Highlight)**：
   树节点、会话列表、导航栏的 Active 态采用 **深底轻微抬升 + 左侧 3px 橙条**，而非大面积实心铺满强调色。
4. **极细发丝分割线 (Hairline Borders)**：
   边框采用 `rgba(255, 255, 255, 0.08)` 到 `rgba(255, 255, 255, 0.12)` 的细微半透明灰阶，杜绝重阴影与粗描边。
5. **大圆角与流线型卡片 (Smooth Curvature)**：
   - 基础按钮与输入框：`12px` ~ `14px`
   - 对话框与大卡片：`16px` ~ `20px`
   - 发送按钮与悬浮入口：`50%`（正圆形，保持 32px / 48px 标准）
6. **克制的三级文字阶梯 (Restrained Typography)**：
   - 一级主标题 / 正文：`#F2F2F2` (近白，无频闪对比)
   - 二级说明 / 标签：`#A3A3A3`
   - 三级次要 / 时间戳 / 占位符：`#737373`
7. **触控与移动端密度规整 (Touch-Density Calibration)**：
   - 移动端顶栏高度保持 `calc(52px + var(--dsh-sat))`
   - 基础可点击目标高度 `≥ 44px`（内联操作钮除外）
   - 输入框卡片紧凑化，保持舒适的拇指热区
8. **弱动效兼容 (Reduced Motion)**：
   严格同步关停 `animation` 与 `transition`，消除低性能设备或特殊偏好下的卡顿感。

---

## 二、 Token 映射表与色板标准 (Tokens)

通过覆盖宿主真实存在的 CSS 自定义属性（`--dsw-*`）实现无缝换肤：

| 抽象语义 | 标准色值 (Hex / RGBA) | 宿主映射 Token (`--dsw-*`) | 说明 |
| :--- | :--- | :--- | :--- |
| **画布底色** | `#1A1A1A` | `--dsw-alias-bg-base` | 全局底层背景、会话滚动区 |
| **层级表面 1** | `#222222` | `--dsw-alias-bg-layer-1` | 侧边栏底色、设置项卡片底色 |
| **层级表面 2** | `#262626` | `--dsw-alias-bg-layer-2` | 浮层卡片、弹窗对话框底色 |
| **提升层/组件底色** | `#2A2A2A` | `--dsw-alias-bg-module-platform` | 输入框底色、Segmented Tabs 槽底色 |
| **侧边栏专用底色** | `#222222` | `--dsw-specific-sidebar-fill` | 侧栏抽屉全量背景 |
| **主要文字** | `#F2F2F2` | `--dsw-alias-label-primary` | 标题、主要消息内容 |
| **次要文字** | `#A3A3A3` | `--dsw-alias-label-secondary` | 副标题、属性标签 |
| **辅助文字** | `#737373` | `--dsw-alias-label-tertiary` | 时间戳、弱提示、快捷键标注 |
| **主品牌色** | `#E85D3A` | `--dsw-alias-brand-primary` | 主按钮、选中态、聚焦光圈色 |
| **主操作填充** | `#E85D3A` | `--dsw-alias-button-primary-fill`| 发送按钮、主确认按钮背景 |
| **品牌微光底色** | `rgba(232, 93, 58, 0.12)` | `--dsw-alias-brand-subtle` | 选中行微光背景、气泡微高亮 |
| **一级细边框** | `rgba(255, 255, 255, 0.08)` | `--dsw-alias-border-l1` | 列表项分割线、内嵌面板描边 |
| **二级分割边框** | `rgba(255, 255, 255, 0.12)` | `--dsw-alias-border-l2` | 顶栏下划线、弹窗外轮廓 |
| **悬浮交互底** | `rgba(255, 255, 255, 0.06)` | `--dsw-alias-interactive-bg-hover` | 图标按钮 hover、行轻量悬浮 |
| **悬浮按压底** | `rgba(255, 255, 255, 0.10)` | `--dsw-alias-interactive-bg-hover-solid` | 移动端触控按下反馈态 |

> **排坑说明**：宿主**不存在** `--dsw-alias-bg-inverse` 和 `--dsw-alias-label-inverse`，严禁在 CSS 中引用此类伪变量。

---

## 三、 手机端核心组件适配规范 (Mobile Component Spec)

### 1. 顶部状态栏与导航条 (`.dsh-mobile-bar`)
- 背景采用 `color-mix(in srgb, #1A1A1A 92%, transparent)`，叠加 `backdrop-filter: blur(18px)`。
- 底边框：`1px solid rgba(255, 255, 255, 0.08)`。
- 标题采用 `#F2F2F2`，状态指示器保持低饱和绿点与橙色计划模式点。

### 2. 侧边栏与抽屉 (`[data-slot="sidebar"]`)
- 背景直接锁定 `#222222`，与主内容区形成微妙且自然的阶梯反差。
- 会话条目采用 `border-radius: 10px`。
- Active 会话：背景 `#2A2A2A`，左侧边缘带 `inset 3px 0 0 #E85D3A`，文字纯白。

### 3. 输入区与底部操作栏 (`[data-composer-card]`)
- 输入卡片背景：`#2A2A2A`，外边框 `1px solid rgba(255, 255, 255, 0.10)`，聚焦时光圈切换为 `rgba(232, 93, 58, 0.25)`。
- 文本域文字：`#F2F2F2`，Placeholder：`#737373`。
- **发送按钮** (`.uV2eYG_primary`)：保持 `32px` 正圆规范，背景走宿主 info 填充（暗色近白 / 浅色近黑），不用品牌橙；点击按压反馈缩放至 `scale(0.95)`。
- 工具箱入口与附件上传按钮：背景 `#2A2A2A`，图标颜色 `#A3A3A3`，按下态切换为 `#333333`。

### 4. 气泡与模型/状态标签 (Chips & Bubbles)
- 模型与参数 Chip：未选态为灰黑胶囊 (`#2A2A2A` + 浅边)，选中态为低对比抬升（`--dsw-alias-interactive-bg-hover-solid` + 主文字），不用大面积品牌橙。
- AI 消息与用户消息气泡保持灰阶克制，避免饱和色块对阅读产生干扰。

### 5. 底部抽屉与弹窗 (Bottom Sheets & Modals)
- 抽屉背景采用 `#222222`，顶部手柄胶囊色 `#444444`。
- 外轮廓使用 `1px solid rgba(255, 255, 255, 0.12)`，配合宿主标准层级阴影 `--dsw-shadow-lv3`。

---

## 四、 插件架构与落地步骤 (Implementation Plan)

### 目录结构规划
```
plugins/dsh-zcode-theme/
├── package.json          # 插件元信息与依赖
├── README.md             # 使用与效果说明文档
├── cordis.patch.yml      # Cordis 插件注册声明
├── lib/
│   ├── index.js          # 后端服务入口（配置项与版本）
│   ├── client.js         # 前端注入脚本（CSS 变量与样式注入）
│   └── tokens.js         # 主题色彩 Token 定义（支持扩展浅色套）
└── test/
    └── theme.test.mjs    # 自动化单元测试（断言 Token 覆盖度、禁用蓝底残留）
```

### 实施路线
1. **第一阶段：Token 常量与注入机制搭建**
   - 新建插件骨架，编写 `lib/tokens.js` 与 `lib/client.js`。
   - 实现无侵入 `<style id="dsh-zcode-theme">` 注入与销毁逻辑。
2. **第二阶段：移动端与组件表面微调**
   - 覆盖 `.uV2eYG_primary`、`.rS3zOq_chip`、`.dsh-mobile-bar`、`.dm-container` 等全量组件的强调色与背景色。
   - 彻底消灭原宿主残留的 `#4d6bfe` 蓝色回退值。
3. **第三阶段：自动化验证与测试集**
   - 编写 Node.js 单元测试，静态比对提取出的 CSS 规则，确保所有品牌强调色皆已正确绑定至 `#E85D3A` 系列。
4. **第四阶段：集成发布与文档补充**
   - 在 `LOCAL_MONOREPO_PLUGINS` 中登记 `dsh-zcode-theme`，更新主根目录 README 矩阵。
