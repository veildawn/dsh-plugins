# dsh-ai-proxy 适配器核心缺陷分析与修复方案

本文档记录了在 DSH (DeepSeek Harness) 中使用 `dsh-ai-proxy` 插件时遇到的两个核心问题及其成因与解决方案：
1. **Tool Result 包含图片导致会话崩溃 (`UNSUPPORTED_CONTENT`)**
2. **Anthropic 协议下推理档位（Effort）设置 `high` 却被降为 `medium`**

---

## 问题一：Tool Result 包含图片导致会话持续崩溃

### 1. 现象描述
运行含有读取图片（如调用 `read_image`）或工具返回图片时，控制台/会话报错并中断：
```
本轮运行失败 AI Proxy adapter cannot represent an image inside a tool result.
UNSUPPORTED_CONTENT
```
一旦发生该报错，由于上下文日志中已记录了含有图片的 `tool-result`，后续在同一会话的每一次新交互都会在序列化上下文时重复崩溃。

### 2. 根本原因
- **代码位置**：`lib/index.js` 中的 `serializeMessages` 函数（第 216-220 行附近）。
- **原因分析**：
  在走 OpenAI Chat Completions 协议时，适配器检查每个 `tool-result` 块：
  ```javascript
  const toolResults = message.content.filter((block) => block.type === 'tool-result')
  for (const result of toolResults) {
    if (contentHasImage(result.content)) {
      throw new LlmError('AI Proxy adapter cannot represent an image inside a tool result.', 'UNSUPPORTED_CONTENT')
    }
  }
  ```
  OpenAI 的 `/v1/chat/completions` 协议及 Responses 规范中，`role: "tool"`（或 `function_call_output`）的 `output/content` 字段标准仅支持字符串（string），不支持多模态 content parts（如 `image_url` / `input_image`）。
  因此适配器做了防御性阻断抛错，导致会话直接不可逆崩溃。

### 3. 修复与优化方案
针对该问题，适配器应提供容错与优雅降级机制，避免会话永久瘫痪：

1. **方案 A（降级占位文本，防止会话崩溃）**：
   当检测到 `tool-result` 中包含图片时，不再抛出致命异常 `LlmError`，而是将图片信息转为文本描述占位符（如 `[Image: <path or attachmentId>]`），确保历史消息能够继续序列化并发送。
2. **方案 B（自动拆分注入为 User 消息）**：
   在序列化工具返回结果时，若包含图片块，将文本部分保留在 `role: "tool"` 中，同时自动在后续提取并构造一条 `role: "user"` 多模态消息（携带 `image_url`）附加到上下文，让 OpenAI 兼容模型能够看到图片。

---

## 问题二：Anthropic 协议下 Effort 档位未生效（high 变为 medium）

### 1. 现象描述
在前端或 Agent 设置中将模型推理深度/思考档位设为 `high`，但上游实际接收并执行时却以 `medium`（默认档位）运行。

### 2. 根本原因
- **代码位置**：`lib/index.js` 中的 `serializeAnthropicRequest` 函数（第 354-356 行附近）。
- **原因分析**：
  在构建 Anthropic Messages 请求体时，代码逻辑如下：
  ```javascript
  if (options.purpose !== 'session-title' && options.reasoningEffort !== undefined && options.reasoningEffort !== 'none' && options.reasoningEffort !== '') {
    body.thinking = { type: 'adaptive' }
  }
  ```
  可以看到，代码仅判断了 `options.reasoningEffort` 是否有效，但仅固定设置了 `body.thinking = { type: 'adaptive' }`，**完全丢弃了 `options.reasoningEffort` 变量的值**！
  未向上游传递具体的 effort 档位，上游 Anthropic 模型或网关因缺少显式参数，默认回退到了 `medium` 档位。

### 3. 修复方案
按照 Anthropic Messages API 标准（自适应思考 Adaptive Thinking 规范）：
1. 在 `serializeAnthropicRequest` 中加入 `output_config.effort` 参数透传：
   ```javascript
   if (options.purpose !== 'session-title' && options.reasoningEffort !== undefined && options.reasoningEffort !== 'none' && options.reasoningEffort !== '') {
     body.thinking = { type: 'adaptive' }
     body.output_config = { effort: options.reasoningEffort }
   }
   ```
2. （可选，针对不同中转网关兼容性）如果所使用的网关支持顶层 `effort` 或通过 `betas` 请求头，可一并添加兜底兼容。

---

## 涉及文件清单
- 插件源码目录：`/root/CodeSpace/dsh-plugins/plugins/dsh-ai-proxy/`
- 核心修改文件：`/root/CodeSpace/dsh-plugins/plugins/dsh-ai-proxy/lib/index.js`
  - `serializeMessages`（图片防御与降级）
  - `serializeAnthropicRequest`（thinking 与 effort 传递）
