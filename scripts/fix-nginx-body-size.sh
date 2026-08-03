#!/bin/bash
# 修复 Nginx 请求体大小限制（413 错误修复）
# 用法：bash scripts/fix-nginx-body-size.sh

NGINX_CONF="/etc/nginx/sites-available/food.hywellness.com"

if [ ! -f "$NGINX_CONF" ]; then
    echo "❌ 找不到 Nginx 配置文件: $NGINX_CONF"
    echo "请手动检查 Nginx 配置文件位置"
    exit 1
fi

echo "📝 修改 Nginx 配置: $NGINX_CONF"

# 检查是否已存在 client_max_body_size
if grep -q "client_max_body_size" "$NGINX_CONF"; then
    echo "   已存在 client_max_body_size 配置，进行更新..."
    sed -i 's/client_max_body_size.*/client_max_body_size 50m;/' "$NGINX_CONF"
else
    echo "   添加 client_max_body_size 配置..."
    # 在 location /api/ { 后面添加
    sed -i '/location \/api\/ {/a\        # 允许大文件上传（预付款附件等）\n        client_max_body_size 50m;' "$NGINX_CONF"
fi

echo "✅ Nginx 配置已更新"
echo "🔄 重新加载 Nginx..."
nginx -t && systemctl reload nginx
echo "✅ Nginx 已重新加载"
echo ""
echo "🎉 修复完成！现在可以上传更大的附件了。"
