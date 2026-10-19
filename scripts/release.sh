#!/usr/bin/env bash
set -e

# Usage: ./scripts/release.sh <plugin_name> [version]
# Example: ./scripts/release.sh dsh-mobile-adapter 0.1.5
#          ./scripts/release.sh dsh-remote-control

PLUGIN=$1
VERSION=$2

if [ -z "$PLUGIN" ]; then
  echo "❌ 请指定插件目录名！可用插件："
  ls -1 plugins/
  echo ""
  echo "用法: $0 <plugin_name> [version]"
  echo "示例: $0 dsh-mobile-adapter 0.1.5"
  exit 1
fi

PLUGIN_DIR="plugins/$PLUGIN"

if [ ! -d "$PLUGIN_DIR" ]; then
  echo "❌ 错误: 找不到目录 $PLUGIN_DIR"
  exit 1
fi

# 如果未传 version，自动从对应插件的 package.json 中读取
if [ -z "$VERSION" ]; then
  VERSION=$(node -p "require('./$PLUGIN_DIR/package.json').version")
fi

TAG="${PLUGIN}@v${VERSION}"

echo "=========================================="
echo "📦 准备发布插件独立版本:"
echo "   插件: $PLUGIN"
echo "   版本: $VERSION"
echo "   Tag : $TAG"
echo "=========================================="

# 0. 宿主兼容预检：peerDependencies 必须被当前 dsh 运行时接受
#    （范围写错时 profile 启动会直接拒载该插件："is incompatible with dsh ..."）。
#    机器上没有 dsh 时该检查打印 SKIP 退出 0，不阻塞发布。
echo "🧭 正在校验 $PLUGIN 的 dsh 宿主兼容声明..."
node "$(dirname "$0")/check-plugin-compat.mjs" "$PLUGIN_DIR"

# 0.1 宿主加载预检：入口能被真实宿主 import，且 bundle patch 只注入宿主
#     确实提供的服务（0.2.1-rc.2 删掉 webRuntime 后，旧 patch 会让 profile
#     启动直接失败："1 required plugin did not activate"）。同样无 dsh 时 SKIP。
echo "🔌 正在校验 $PLUGIN 能被当前 dsh 宿主加载..."
node "$(dirname "$0")/check-host-load.mjs" "$PLUGIN_DIR"

# 0.2 样式预检：插件 CSS 里的宿主哈希类名必须仍在宿主 bundle 中存在。
#     宿主改名后旧哈希不会报错，只会静默失效（0.2.1-rc.2 就是这样让移动端
#     统计行重新冒出、并把 ∨ 箭头带回权限按钮）。同样无 dsh 时 SKIP。
echo "🎨 正在校验 $PLUGIN 的样式哈希仍匹配当前 dsh 宿主..."
node "$(dirname "$0")/check-host-hashes.mjs" "$PLUGIN_DIR"

# 0.3 发布内容闸门：files 白名单漏文件时本地测试照样通过（测试直接读源码
#     目录），但用户装到 profile 后会 import 失败；反过来白名单写宽会把
#     test/、node_modules/、历史 tgz 一起发出去。这里对最终产物做一次断言。
echo "🔍 正在校验 $PLUGIN 的 npm 发布内容..."
node "$(dirname "$0")/verify-pack-contents.mjs" --plugin "$PLUGIN"

# 1. 运行该插件测试
# 插件从 profile 的共享目录解析宿主包，其位置随 HOME 变化，所以不能写死。
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
echo "🧪 正在运行 $PLUGIN 自动化测试..."
(cd "$PLUGIN_DIR" && NODE_PATH="$DSH_HOME/profiles/node_modules:$DSH_HOME/profiles/web/node_modules" npm test)

# 2. 打包生成 tgz
#    npm pack 会把 scope 展平进文件名（@weniatall/dsh-terminal@0.1.16 ->
#    weniatall-dsh-terminal-0.1.16.tgz），但 dsh-plugin-manager 的
#    isAllowedRepoUrl 白名单要求资产名是 "<短名>-<版本>.tgz"，所以显式重命名。
#    这里必须按确定的名字取，不能用 `ls *.tgz | head -1`：插件目录里通常还留着
#    几十个历史 tgz，那会取到错误的文件。
echo "📦 打包 tgz..."
TGZ_NAME="${PLUGIN}-${VERSION}.tgz"
TGZ_FILE="$PLUGIN_DIR/$TGZ_NAME"
(cd "$PLUGIN_DIR" && npm pack --silent >/dev/null)
PACKED_FILE=$(ls "$PLUGIN_DIR"/*.tgz -t | head -n 1)
if [ "$(basename "$PACKED_FILE")" != "$TGZ_NAME" ]; then
  mv "$PACKED_FILE" "$TGZ_FILE"
fi
if [ ! -f "$TGZ_FILE" ]; then
  echo "❌ 打包失败：未找到 $TGZ_FILE"
  exit 1
fi
echo "   产物: $TGZ_NAME"

# 3. 创建 Git Tag 并推送到 GitHub，触发独立 Release
#    tag 保持无 scope 短名（${PLUGIN}@v${VERSION}），与 GitHub Release 下载
#    URL 和 isAllowedRepoUrl 白名单一致；npm 包名带 scope 是另一回事。
echo "🏷️ 创建 Git Tag 并推送..."
git tag -a "$TAG" -m "Release $TAG" || true
git push origin "$TAG"

# 4. 同时通过 GitHub CLI 直接发布 Release 并上传 assets
echo "🚀 创建 GitHub 独立 Release..."
gh release create "$TAG" "$TGZ_FILE" \
  --title "$PLUGIN v$VERSION" \
  --notes "### 📦 $PLUGIN Release (v$VERSION)

#### 💻 安装方式 (Installation)

通过 npm registry（推荐，自动跟随最新版）：
\`\`\`bash
dsh plugin --profile web add $(node -p "require('./$PLUGIN_DIR/package.json').name")
\`\`\`

或从 GitHub Release 安装固定版本的 tarball：
\`\`\`bash
dsh plugin --profile web add https://github.com/veildawn/dsh-plugins/releases/download/$TAG/$TGZ_NAME
\`\`\`

#### 🔄 重启服务 (Restart Service)
- **macOS / Linux**: \`./scripts/dsh-web.sh restart\`
- **Windows**: \`.\\scripts\\dsh-web.ps1 restart\` (或 \`scripts\\dsh-web.cmd restart\`)"

# 清理本地打包 tgz
rm -f "$TGZ_FILE"

echo ""
echo "🎉 发布成功！Release 地址:"
echo "👉 https://github.com/veildawn/dsh-plugins/releases/tag/$TAG"
