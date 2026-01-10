/**
 * AnyRouter Telegram Bot - Cloudflare Worker
 *
 * Environment Variables (set in Cloudflare Dashboard):
 * - TELEGRAM_BOT_TOKEN: Telegram Bot Token
 * - TELEGRAM_CHAT_ID: Allowed Chat IDs (comma separated)
 * - GITHUB_TOKEN: GitHub Personal Access Token
 * - GITHUB_REPO: Repository name, format: owner/repo
 * - BOT_SECRET: Webhook secret key (optional)
 * - ANYROUTER_ACCOUNTS: Account configs JSON (for real-time balance)
 */

const COMMANDS = {
	'/start': `<b>Welcome to AnyRouter Check-in Bot!</b>

Available commands:
/status - View real-time balance
/checkin - Trigger check-in
/history - View check-in history
/help - Show this help`,

	'/help': `<b>Available Commands</b>

/status - View current account balance (real-time)
/checkin - Manually trigger check-in
/history - View recent check-in history
/help - Show this help message

<i>Bot runs automatically every 6 hours</i>`,
};

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		// GET request - show status or setup commands
		if (request.method === 'GET') {
			// Setup bot commands: /setup?token=xxx
			if (url.pathname === '/setup') {
				return await setupBotCommands(env);
			}
			return new Response('AnyRouter Telegram Bot is running!', { status: 200 });
		}

		if (request.method !== 'POST') {
			return new Response('Method not allowed', { status: 405 });
		}

		// Verify secret key (optional)
		if (env.BOT_SECRET && url.pathname !== `/${env.BOT_SECRET}`) {
			return new Response('Unauthorized', { status: 401 });
		}

		try {
			const update = await request.json();
			const message = update.message || update.edited_message;

			if (!message || !message.text) {
				return new Response('OK', { status: 200 });
			}

			const chatId = message.chat.id.toString();
			const text = message.text.trim();
			const allowedChats = (env.TELEGRAM_CHAT_ID || '').split(',').map(id => id.trim());

			// Verify Chat ID
			if (allowedChats.length > 0 && allowedChats[0] !== '' && !allowedChats.includes(chatId)) {
				await sendMessage(env, chatId, 'Unauthorized user');
				return new Response('OK', { status: 200 });
			}

			// Handle commands
			const command = text.split(' ')[0].toLowerCase();
			let response = '';

			switch (command) {
				case '/start':
				case '/help':
					response = COMMANDS[command];
					break;

				case '/status':
					response = await getAccountStatus(env);
					break;

				case '/checkin':
					response = await triggerCheckin(env);
					break;

				case '/history':
					response = await getHistory(env);
					break;

				default:
					if (text.startsWith('/')) {
						response = 'Unknown command. Use /help for available commands.';
					}
			}

			if (response) {
				await sendMessage(env, chatId, response);
			}

			return new Response('OK', { status: 200 });
		} catch (error) {
			console.error('Error:', error);
			return new Response('Error', { status: 500 });
		}
	}
};

// Setup bot commands (call once via GET /setup)
async function setupBotCommands(env) {
	if (!env.TELEGRAM_BOT_TOKEN) {
		return new Response('TELEGRAM_BOT_TOKEN not set', { status: 400 });
	}

	const commands = [
		{ command: 'status', description: 'View real-time balance' },
		{ command: 'checkin', description: 'Trigger check-in' },
		{ command: 'history', description: 'View check-in history' },
		{ command: 'help', description: 'Show help message' },
	];

	const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ commands })
	});

	const result = await response.json();
	return new Response(JSON.stringify(result, null, 2), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}

// Send Telegram message
async function sendMessage(env, chatId, text) {
	const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
	await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			chat_id: chatId,
			text: text,
			parse_mode: 'HTML',
			disable_web_page_preview: true
		})
	});
}

// Get account status with real-time balance query
async function getAccountStatus(env) {
	if (!env.ANYROUTER_ACCOUNTS) {
		return '未配置 ANYROUTER_ACCOUNTS 环境变量';
	}
	if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
		return 'GitHub configuration not set';
	}

	try {
		// 1. Read WAF cookies from repo
		const wafUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/waf_cookies.json`;
		const wafResp = await fetch(wafUrl, {
			headers: {
				'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
				'User-Agent': 'AnyRouter-Bot',
				'Accept': 'application/vnd.github.v3+json'
			}
		});

		let wafCookies = {};
		if (wafResp.ok) {
			const wafData = await wafResp.json();
			if (wafData.content) {
				wafCookies = JSON.parse(atob(wafData.content.replace(/\n/g, '')));
			}
		}

		// 2. Parse accounts
		const accounts = JSON.parse(env.ANYROUTER_ACCOUNTS);
		const results = [];

		for (const account of accounts) {
			const name = account.name || 'Unknown';
			const provider = account.provider || 'anyrouter';
			const domain = 'https://anyrouter.top';

			try {
				// Build cookie string: WAF cookies + account cookies
				let cookieParts = [];

				// Add WAF cookies for this provider
				if (wafCookies[provider]?.cookies) {
					for (const [k, v] of Object.entries(wafCookies[provider].cookies)) {
						cookieParts.push(`${k}=${v}`);
					}
				}

				// Add account cookies
				if (typeof account.cookies === 'object') {
					for (const [k, v] of Object.entries(account.cookies)) {
						cookieParts.push(`${k}=${v}`);
					}
				} else if (account.cookies) {
					cookieParts.push(account.cookies);
				}

				const cookieStr = cookieParts.join('; ');

				const resp = await fetch(`${domain}/api/user/self`, {
					method: 'GET',
					headers: {
						'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
						'Accept': 'application/json, text/plain, */*',
						'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
						'Referer': domain,
						'Origin': domain,
						'Cookie': cookieStr,
						'new-api-user': account.api_user || ''
					}
				});

				if (resp.ok) {
					const data = await resp.json();
					if (data.success && data.data) {
						const quota = (data.data.quota / 500000).toFixed(2);
						const used = (data.data.used_quota / 500000).toFixed(2);
						results.push({ name, success: true, balance: `$${quota}`, used: `$${used}` });
						continue;
					}
				}
				results.push({ name, success: false, error: `HTTP ${resp.status}` });
			} catch (e) {
				results.push({ name, success: false, error: e.message });
			}
		}

		// Format response
		const now = new Date(Date.now() + 8 * 60 * 60 * 1000); // UTC+8
		const timeStr = `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;

		let msg = `<b>💰 实时余额</b>\n\n`;
		for (const r of results) {
			const icon = r.success ? '✅' : '❌';
			msg += `${icon} <b>${r.name}</b>\n`;
			if (r.success) {
				msg += `    余额: <code>${r.balance}</code>\n`;
				msg += `    已用: <code>${r.used}</code>\n`;
			} else {
				msg += `    <i>查询失败: ${r.error}</i>\n`;
			}
		}
		msg += `\n<i>🕐 ${timeStr}</i>`;

		// Show WAF cookie age if available
		if (wafCookies.anyrouter?.updated_at) {
			msg += `\n<i>🔑 WAF: ${wafCookies.anyrouter.updated_at.slice(5, 16)}</i>`;
		}

		return msg;
	} catch (error) {
		return `查询失败: ${error.message}`;
	}
}

// Get check-in history
async function getHistory(env) {
	if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
		return 'GitHub configuration not set';
	}

	try {
		// Try to get balance history file
		const historyUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/balance_history.json`;
		const historyResponse = await fetch(historyUrl, {
			headers: {
				'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
				'User-Agent': 'AnyRouter-Bot',
				'Accept': 'application/vnd.github.v3+json'
			}
		});

		if (historyResponse.ok) {
			const historyData = await historyResponse.json();
			if (historyData.content) {
				const content = atob(historyData.content.replace(/\n/g, ''));
				const history = JSON.parse(content);

				if (history.length > 0) {
					let msg = `<b>📊 签到历史</b>\n\n`;

					// Show last 5 records
					const records = history.slice(-5).reverse();
					for (const record of records) {
						const icon = record.success ? '✅' : '❌';
						// Format time shorter: MM-DD HH:MM
						const shortTime = record.time.slice(5, 16);
						msg += `${icon} <b>${shortTime}</b>\n`;

						for (const acc of record.accounts || []) {
							const accIcon = acc.success ? '✓' : '✗';
							msg += `    ${accIcon} ${acc.name}`;
							if (acc.balance) {
								msg += `  <code>${acc.balance}</code>`;
							}
							msg += '\n';
						}
						msg += '\n';
					}

					msg += `<i>共 ${records.length} 条记录</i>`;
					return msg;
				}
			}
		}

		// Fallback to workflow runs if no history file
		const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/runs?per_page=10`;
		const response = await fetch(url, {
			headers: {
				'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
				'User-Agent': 'AnyRouter-Bot'
			}
		});

		const data = await response.json();
		const runs = data.workflow_runs || [];

		if (runs.length === 0) {
			return 'No check-in records yet.';
		}

		let history = `<b>📊 Check-in History</b>\n`;
		history += `<code>─────────────────────</code>\n\n`;

		for (const run of runs.slice(0, 5)) {
			const time = formatTime(run.created_at);
			const icon = run.conclusion === 'success' ? '✅' :
			             run.conclusion === 'failure' ? '❌' :
			             run.status === 'in_progress' ? '🔄' : '⏳';
			const status = run.conclusion || run.status || 'pending';

			history += `${icon} <code>${time}</code> ${status}\n`;
		}

		history += `\n<i>Showing last 5 records</i>`;
		return history;
	} catch (error) {
		return `Failed to get history: ${error.message}`;
	}
}

// Trigger check-in (via GitHub Actions)
async function triggerCheckin(env) {
	if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
		return 'GitHub configuration not set';
	}

	try {
		const url = `https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`;
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
				'User-Agent': 'AnyRouter-Bot',
				'Accept': 'application/vnd.github.v3+json',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				event_type: 'telegram_checkin',
				client_payload: { triggered_by: 'telegram' }
			})
		});

		if (response.status === 204 || response.status === 200) {
			return `<b>Check-in Triggered!</b>

The check-in process has started.

Please wait 1-2 minutes for results.
You will receive a notification when complete.

Use /history to check progress.`;
		} else {
			const text = await response.text();
			return `Trigger failed: ${response.status}\n${text}`;
		}
	} catch (error) {
		return `Trigger failed: ${error.message}`;
	}
}

// Format time to Beijing time (UTC+8)
function formatTime(isoString) {
	const date = new Date(isoString);
	// Convert to UTC+8
	const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000);
	const month = String(utc8.getUTCMonth() + 1).padStart(2, '0');
	const day = String(utc8.getUTCDate()).padStart(2, '0');
	const hours = String(utc8.getUTCHours()).padStart(2, '0');
	const minutes = String(utc8.getUTCMinutes()).padStart(2, '0');
	return `${month}-${day} ${hours}:${minutes}`;
}
