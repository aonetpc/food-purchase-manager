#!/bin/bash
# ================================================
# 食材采购管理系统 - SSL证书一键配置脚本
# 域名: food.hywellness.com
# ================================================

set -e

DOMAIN="food.hywellness.com"
EMAIL="admin@hywellness.com"  # 修改为你的邮箱，用于Let's Encrypt通知
BACKEND_PORT="3000"           # 后端服务端口

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  SSL证书配置脚本${NC}"
echo -e "${GREEN}  域名: $DOMAIN${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 检查是否root用户
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}请使用 sudo 或 root 用户运行此脚本${NC}"
  exit 1
fi

# 1. 更新系统
echo -e "${YELLOW}[1/6] 更新系统包...${NC}"
apt-get update -qq

# 2. 安装必要软件
echo -e "${YELLOW}[2/6] 安装 Nginx 和 Certbot...${NC}"
apt-get install -y -qq nginx certbot python3-certbot-nginx

# 3. 检查域名解析
echo -e "${YELLOW}[3/6] 检查域名解析...${NC}"
SERVER_IP=$(curl -s ifconfig.me || curl -s icanhazip.com)
DOMAIN_IP=$(dig +short $DOMAIN || nslookup $DOMAIN | grep -A1 "Name:" | tail -1 | awk '{print $2}')

echo "  服务器公网IP: $SERVER_IP"
echo "  域名解析IP:   $DOMAIN_IP"

if [ "$SERVER_IP" != "$DOMAIN_IP" ]; then
  echo -e "${RED}  ⚠️ 警告: 域名解析IP ($DOMAIN_IP) 与服务器IP ($SERVER_IP) 不一致${NC}"
  echo "  请确认域名已正确解析到本服务器，或继续执行（如果不是A记录可能误判）"
  read -p "  是否继续? (y/n): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# 4. 停止占用80端口的服务（如果有）
echo -e "${YELLOW}[4/6] 释放80端口...${NC}"
if lsof -i :80 >/dev/null 2>&1; then
  systemctl stop nginx 2>/dev/null || true
  echo "  已停止nginx"
fi

# 5. 申请SSL证书
echo -e "${YELLOW}[5/6] 申请 Let's Encrypt SSL证书...${NC}"
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo -e "  ${GREEN}证书已存在，尝试续期...${NC}"
  certbot renew --quiet
else
  certbot certonly --standalone \
    -d $DOMAIN \
    --agree-tos \
    --non-interactive \
    --email $EMAIL \
    --preferred-challenges http
fi

# 检查证书是否生成成功
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  echo -e "${RED}❌ 证书申请失败，请检查域名解析和80端口是否可用${NC}"
  exit 1
fi

echo -e "  ${GREEN}✅ 证书申请成功${NC}"

# 6. 配置Nginx
echo -e "${YELLOW}[6/6] 配置Nginx反向代理...${NC}"

cat > /etc/nginx/sites-available/$DOMAIN << 'EOF'
server {
    listen 80;
    server_name food.hywellness.com;
    
    # 自动跳转到HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name food.hywellness.com;

    # SSL证书配置
    ssl_certificate /etc/letsencrypt/live/food.hywellness.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/food.hywellness.com/privkey.pem;
    
    # SSL优化配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # 安全响应头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # 前端静态文件
    location / {
        root /var/www/food-purchase/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # API接口转发到后端
    location /api/ {
        # 允许大文件上传（预付款附件等）
        client_max_body_size 50m;
        proxy_pass http://localhost:3000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # 企微回调
    location /wecom/ {
        proxy_pass http://localhost:3000/wecom/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

# 启用站点配置
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN

# 删除默认配置（避免冲突）
rm -f /etc/nginx/sites-enabled/default

# 测试Nginx配置
nginx -t

# 启动Nginx
systemctl restart nginx
systemctl enable nginx

# 7. 配置自动续期
echo -e "${YELLOW}[附加] 配置证书自动续期...${NC}"

# 添加续期后重启nginx的hook
cat > /etc/letsencrypt/renewal-hooks/deploy/restart-nginx.sh << 'EOF'
#!/bin/bash
systemctl reload nginx
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/restart-nginx.sh

# 测试续期
certbot renew --dry-run

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ✅ SSL配置完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  HTTPS地址: https://$DOMAIN"
echo "  API地址:   https://$DOMAIN/api/"
echo "  回调地址:  https://$DOMAIN/api/wecom/callback"
echo ""
echo -e "  ${YELLOW}企微配置建议：${NC}"
echo "  1. 可信域名: $DOMAIN"
echo "  2. 回调URL:  https://$DOMAIN/api/wecom/callback"
echo "  3. 聊天附件栏: https://$DOMAIN/"
echo ""
echo -e "  ${YELLOW}证书信息：${NC}"
echo "  证书路径: /etc/letsencrypt/live/$DOMAIN/"
echo "  自动续期: 已配置（systemd定时任务）"
echo ""
echo -e "  ${YELLOW}验证命令：${NC}"
echo "  curl -I https://$DOMAIN"
echo ""
