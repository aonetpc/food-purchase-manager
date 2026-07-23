# 华医OA管理平台

基于 React + TypeScript + Vite 前端，Node.js + Express + MySQL 后端的食材采购管理系统。

## 技术栈

- **前端**：React 18 + TypeScript + Vite 6 + TailwindCSS 3 + Zustand
- **后端**：Node.js 20 + Express + mysql2
- **数据库**：MySQL 8.0
- **部署**：腾讯云轻量服务器 + Nginx + GitHub Actions 自动部署

## 自动部署

代码推送到 `main` 分支后，GitHub Actions 会自动：

1. 构建前端项目
2. 部署前端到 `/var/www/food-purchase/`
3. 部署后端到 `/opt/food-purchase/backend/`
4. 安装后端依赖并重启服务

## 默认账号

- 管理员：`admin` / `admin123`
- 查看员：`viewer` / `viewer123`
