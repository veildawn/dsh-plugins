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

# 1. 运行该插件测试
# 插件从 profile 的共享目录解析宿主包，其位置随 HOME 变化，所以不能写死。
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
echo "🧪 正在运行 $PLUGIN 自动化测试..."
(cd "$PLUGIN_DIR" && NODE_PATH="$DSH_HOME/profiles/node_modules:$DSH_HOME/profiles/web/node_modules" npm test)

# 2. 打包生成 tgz
echo "📦 打包 tgz..."
(cd "$PLUGIN_DIR" && npm pack)
TGZ_FILE=$(ls "$PLUGIN_DIR"/*.tgz | head -n 1)

# 3. 创建 Git Tag 并推送到 GitHub，触发独立 Release
echo "🏷️ 创建 Git Tag 并推送..."
git tag -a "$TAG" -m "Release $TAG" || true
git push origin "$TAG"

# 4. 同时通过 GitHub CLI 直接发布 Release 并上传 assets
echo "🚀 创建 GitHub 独立 Release..."
gh release create "$TAG" "$TGZ_FILE" \
  --title "$PLUGIN v$VERSION" \
  --notes "### 📦 $PLUGIN Release (v$VERSION)

#### 💻 安装命令 (Installation)
\`\`\`bash
dsh profile --name web plugin add https://github.com/veildawn/dsh-plugins/releases/download/$TAG/$(basename "$TGZ_FILE")
dsh service restart
\`\`\`"

# 清理本地打包 tgz
rm -f "$TGZ_FILE"

echo ""
echo "🎉 发布成功！Release 地址:"
echo "👉 https://github.com/veildawn/dsh-plugins/releases/tag/$TAG"
