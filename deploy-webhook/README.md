# dbd-deploy-webhook

GitHub push webhook 接收端。本地 `git push` 到 `main` 后,GitHub 回调这个服务:校验签名 → `git pull` → 按改动路径决定要不要重启对应服务、重启谁。规则见 `src/deploy.js` 顶部的 `SERVICE_RULES`。

## 一次性安装步骤

1. **属主**(仓库根已统一 chown 给 `www-data`,如果是全新环境需要先做这一步):
   ```bash
   chown -R www-data:www-data /www/wwwroot/bizthai
   chown -R root:root /www/wwwroot/bizthai/dbd-thai/ops/backup   # COS 备份密钥目录保持锁给 root
   ```

2. **`.env`**:
   ```bash
   cp .env.example .env
   # WEBHOOK_SECRET 用: openssl rand -hex 32
   ```

3. **拉代码用的 SSH 身份**(复用现有 write 权限 Deploy Key,拷贝一份 www-data 可读的副本,不改动 root 原密钥权限):
   ```bash
   mkdir -p .ssh
   cp /root/.ssh/id_ed25519 .ssh/deploy_key
   ssh-keyscan -t ed25519 github.com > .ssh/known_hosts
   chown -R www-data:www-data .ssh
   chmod 700 .ssh && chmod 600 .ssh/deploy_key && chmod 644 .ssh/known_hosts
   # 验证:
   sudo -u www-data GIT_SSH_COMMAND="ssh -i $(pwd)/.ssh/deploy_key -o UserKnownHostsFile=$(pwd)/.ssh/known_hosts -o IdentitiesOnly=yes" \
     git -C /www/wwwroot/bizthai fetch origin
   ```

4. **sudoers**(新建 `/etc/sudoers.d/dbd-deploy-webhook`,只精确到这 7 条 `systemctl restart <固定服务名>`,不给通配符):
   ```
   www-data ALL=(root) NOPASSWD: /usr/bin/systemctl restart dbdadmin-woocms-v2
   www-data ALL=(root) NOPASSWD: /usr/bin/systemctl restart dbdresolver-v2
   www-data ALL=(root) NOPASSWD: /usr/bin/systemctl restart dbdai-v2
   www-data ALL=(root) NOPASSWD: /usr/bin/systemctl restart dbdanalytics-v2
   www-data ALL=(root) NOPASSWD: /usr/bin/systemctl restart dbddirectors-v2
   www-data ALL=(root) NOPASSWD: /usr/bin/systemctl restart dbdingest-v2
   www-data ALL=(root) NOPASSWD: /usr/bin/systemctl restart dbdsanitizer-v2
   ```
   校验后生效:`visudo -cf /etc/sudoers.d/dbd-deploy-webhook`

5. **systemd**:
   ```bash
   cp deploy/dbd-deploy-webhook.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now dbd-deploy-webhook
   ```

6. **nginx**:把 `deploy/nginx-deploy-webhook.conf` 的 `location` 塞进 `bizthai.com.conf`(`www2.bizthai.com.conf` 当前是 disabled 状态,暂不需要),`limit_req_zone` 定义加进 `00-rate-limits.conf`(与 `ai_zone`/`directors_zone` 等现有 zone 同一个文件):
   ```
   limit_req_zone $binary_remote_addr zone=deploy_webhook_zone:10m rate=2r/s;
   ```
   `nginx -t` 通过后 `nginx -s reload`。

   **路径不能放在 `/api/internal/` 下**:实测 Cloudflare 边缘对 `/api/internal/*` 有拦截规则(对比 `dbd-thai/ingest` 的内部接口,直连源站 200、经 CF 域名访问 403 且是 CF 拦截页特征),这个命名空间是特意留给"只给白名单 IP 用、绝不对公网开放"的接口。GitHub webhook 必须能从公网打进来,所以放在 `/api/deploy/` 下(已验证这个前缀不受该规则影响)。

7. **GitHub 仓库 Settings → Webhooks → Add webhook**:
   - Payload URL:`https://bizthai.com/api/deploy/github-webhook`
   - Content type:`application/json`
   - Secret:第 2 步生成的值
   - 只勾 "Just the push event"

## 排查

- `curl http://127.0.0.1:9190/api/deploy/health` — 服务本身活着没有
- `dbd-thai/logs/dbddeploy.app.log` / `dbddeploy.app-error.log` — 每次部署的结果(改了哪些文件、重启了谁)
- GitHub 仓库 Settings → Webhooks → Recent Deliveries — 看 GitHub 那侧收到的 HTTP 状态码
- 签名校验失败排查:确认 nginx 把 `X-Hub-Signature-256` 头透传过去了(没有被上游 location 清掉)
