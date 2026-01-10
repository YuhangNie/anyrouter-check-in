/**
 * AnyRouter Telegram Bot - Cloudflare Worker
 *
 * Environment Variables (set in Cloudflare Dashboard):
 * - TELEGRAM_BOT_TOKEN: Telegram Bot Token
 * - TELEGRAM_CHAT_ID: Allowed Chat IDs (comma separated)
 * - GITHUB_TOKEN: GitHub Personal Access Token
 * - GITHUB_REPO: Repository name, format: owner/repo
 * - BOT_SECRET: Webhook secret key (optional)
 */

const COMMANDS = {
	'/start': '👋 Welcome to AnyRouter Check-in Bot!\n\nCommands:\n/status - View check-in status\n/checkin - Trigger check-in\n/help - Show help',
	'/help': '📖 <b>Commands</b>\n\n/status - View recent check-in status\n/checkin - Manually trigger check-in\n/help - Show this help message',
};

export default {
	async fetch(request, env) {
		if (request.method !== 'POST') {
			return new Response('AnyRouter Telegram Bot is running!', { status: 200 });
		}

		// Verify secret key (optional)
		const url = new URL(request.url);
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
			if (allowedChats.length > 0 && !allowedChats.includes(chatId)) {
				await sendMessage(env, chatId, '⛔ Unauthorized user');
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
					response = await getStatus(env);
					break;

				case '/checkin':
					response = await triggerCheckin(env);
					break;

				default:
					if (text.startsWith('/')) {
						response = '❓ Unknown command. Type /help for available commands';
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

// Get check-in status (from GitHub Actions)
async function getStatus(env) {
	if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
		return '⚠️ GitHub configuration not set';
	}

	try {
		const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/runs?per_page=5`;
		const response = await fetch(url, {
			headers: {
				'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
				'User-Agent': 'AnyRouter-Bot'
			}
		});

		const data = await response.json();
		const runs = data.workflow_runs || [];

		if (runs.length === 0) {
			return '📭 No check-in records yet';
		}

		let status = '📊 <b>Recent Check-in Records</b>\n';
		status += '┌──────────────────────┐\n';

		for (const run of runs.slice(0, 3)) {
			const time = new Date(run.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
			const icon = run.conclusion === 'success' ? '✅' : run.conclusion === 'failure' ? '❌' : '🔄';
			const statusText = run.conclusion || 'running';
			status += `│ ${icon} ${statusText.padEnd(8)} ${time.slice(5, 16)} │\n`;
		}

		status += '└──────────────────────┘';
		return status;
	} catch (error) {
		return `❌ Failed to get status: ${error.message}`;
	}
}

// Trigger check-in (via GitHub Actions)
async function triggerCheckin(env) {
	if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
		return '⚠️ GitHub configuration not set';
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
			return '🚀 Check-in triggered!\n\nPlease wait 1-2 minutes and use /status to view results';
		} else {
			const text = await response.text();
			return `❌ Trigger failed: ${response.status} ${text}`;
		}
	} catch (error) {
		return `❌ Trigger failed: ${error.message}`;
	}
}
