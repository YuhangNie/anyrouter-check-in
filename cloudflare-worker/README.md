# Telegram Bot 设置指南

通过 Cloudflare Workers 实现实时响应的 Telegram 机器人。

## 功能

| 命令 | 说明 |
|------|------|
| `/start` | 开始使用 |
| `/help` | 显示帮助 |
| `/status` | 查看最近签到状态 |
| `/checkin` | 手动触发签到 |

## 部署步骤

### 1. 创建 GitHub Personal Access Token

1. 访问 https://github.com/settings/tokens/new
2. 选择 **Generate new token (classic)**
3. 设置：
   - Note: `AnyRouter Bot`
   - Expiration: 选择合适的过期时间
   - Scopes: 勾选 `repo` (Full control)
4. 点击 **Generate token**
5. **复制保存 Token**（只显示一次）

### 2. 部署 Cloudflare Worker

#### 方式一：通过 Dashboard（推荐新手）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages**
3. 点击 **Create Worker**
4. 命名为 `telegram-bot`（或其他名称）
5. 点击 **Deploy**
6. 点击 **Edit Code**
7. 将 `cloudflare-worker/telegram-bot.js` 的内容粘贴进去
8. 点击 **Save and Deploy**

#### 方式二：通过 Wrangler CLI

```bash
# 安装 wrangler
npm install -g wrangler

# 登录
wrangler login

# 部署
cd cloudflare-worker
wrangler deploy
```

### 3. 配置环境变量

在 Cloudflare Worker 设置中添加以下环境变量：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | `123456:ABC-DEF...` |
| `TELEGRAM_CHAT_ID` | 允许的用户 ID | `123456789` |
| `GITHUB_TOKEN` | GitHub PAT | `ghp_xxxx...` |
| `GITHUB_REPO` | 仓库地址 | `YuhangNie/anyrouter-check-in` |
| `BOT_SECRET` | Webhook 密钥（可选） | `my-secret-key` |

**设置步骤**：
1. 进入 Worker 详情页
2. 点击 **Settings** → **Variables**
3. 添加上述变量（敏感信息选择 **Encrypt**）

### 4. 设置 Telegram Webhook

获取你的 Worker URL（格式：`https://telegram-bot.xxx.workers.dev`）

然后在浏览器访问以下链接设置 Webhook：

```
https://api.telegram.org/bot<你的BOT_TOKEN>/setWebhook?url=https://<你的WORKER名>.workers.dev/<BOT_SECRET>
```

**示例**：
```
https://api.telegram.org/bot123456:ABC/setWebhook?url=https://telegram-bot.xxx.workers.dev/my-secret-key
```

如果不使用 BOT_SECRET：
```
https://api.telegram.org/bot123456:ABC/setWebhook?url=https://telegram-bot.xxx.workers.dev
```

成功后会返回：
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

### 5. 测试

在 Telegram 中向你的 Bot 发送 `/help`，应该立即收到回复。

## 故障排除

### 检查 Webhook 状态

访问：
```
https://api.telegram.org/bot<你的BOT_TOKEN>/getWebhookInfo
```

### 删除 Webhook

```
https://api.telegram.org/bot<你的BOT_TOKEN>/deleteWebhook
```

### 常见问题

1. **收不到消息**
   - 检查 TELEGRAM_CHAT_ID 是否正确
   - 检查 Webhook 是否设置成功

2. **签到触发失败**
   - 检查 GITHUB_TOKEN 权限
   - 确认 GITHUB_REPO 格式正确

3. **Unauthorized 错误**
   - 检查 BOT_SECRET 是否匹配

## 费用

- **Cloudflare Workers 免费版**：每天 100,000 次请求，足够个人使用
- **GitHub Actions**：每月 2000 分钟免费
