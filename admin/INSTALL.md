# WooCMS v1.0.43 发行版安装说明

## 1. 解压并配置

```bash
tar -xzf woocms-v1.0.43-*.tar.gz && cd woocms-v1.0.43-*/
cp .env.dist .env
vim .env   # 填写数据库连接、SESSION_SECRET、管理员密码
```

## 2. 创建数据库

```bash
sudo -u postgres psql -c "CREATE USER woocms WITH PASSWORD '你的密码';"
sudo -u postgres psql -c "CREATE DATABASE woocms OWNER woocms;"
sudo -u postgres psql -d woocms -c "CREATE SCHEMA IF NOT EXISTS woocms AUTHORIZATION woocms;"
```

## 3. systemd 服务（必须 Restart=always，远程更新依赖它自动拉起新版本）

以下以默认安装目录 /opt/woocms 为例；若安装到其他目录，请同步替换全部路径。

```ini
[Unit]
Description=WooCMS
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/woocms
EnvironmentFile=/opt/woocms/.env
ExecStart=/opt/woocms/woocms
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now woocms
```

## 4. 远程更新

更新服务器已预配置在 .env 中（UPDATE_SERVER_URL / UPDATE_TOKEN）。
启动后进入后台「系统设置 → 系统更新」即可检查并一键更新。
数据库迁移在每次启动时自动应用，无需手动操作。
