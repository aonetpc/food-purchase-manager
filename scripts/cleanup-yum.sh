#!/bin/bash
# 手动清理坏掉的 yum 仓库

# 禁用 pgdg 仓库
for f in /etc/yum.repos.d/pgdg*.repo /etc/yum.repos.d/pgdg*.repo.disabled; do
    [ -f "$f" ] && mv "$f" "${f}.bak"
done

# 清理缓存
rm -rf /var/cache/yum/*
yum clean all

echo "=== 修复完成，现在可以正常安装 ==="
echo "接下来执行："
echo "  sudo bash fix-yum-and-install.sh"
