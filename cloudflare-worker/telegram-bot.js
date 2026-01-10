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
	'/start': `<b>Welcome to AnyRouter Check-in Bot!</b>

Available commands:
/status - View account balance
/checkin - Trigger check-in
/history - View check-in history
/help - Show this help`,

	'/help': `<b>Available Commands</b>

/status - View current account balance and usage
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
		{ command: 'status', description: 'View account balance' },
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

// Get account status (balance info from latest workflow artifact)
async function getAccountStatus(env) {
	if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
		return 'GitHub configuration not set';
	}

	try {
		// Get latest successful workflow run
		const runsUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/runs?status=success&per_page=1`;
		const runsResponse = await fetch(runsUrl, {
			headers: {
				'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
				'User-Agent': 'AnyRouter-Bot'
			}
		});

		const runsData = await runsResponse.json();
		const runs = runsData.workflow_runs || [];

		if (runs.length === 0) {
			return 'No successful check-in records found.\n\nUse /checkin to trigger one.';
		}

		const latestRun = runs[0];
		const runTime = formatTime(latestRun.created_at);

		// Try to get job logs for balance info
		const jobsUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/runs/${latestRun.id}/jobs`;
		const jobsResponse = await fetch(jobsUrl, {
			headers: {
				'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
				'User-Agent': 'AnyRouter-Bot'
			}
		});

		const jobsData = await jobsResponse.json();
		const job = jobsData.jobs?.[0];

		let status = `<b>Account Status</b>\n`;
		status += `<code>─────────────────────</code>\n\n`;
		status += `Last check-in: ${runTime}\n`;
		status += `Status: ${latestRun.conclusion === 'success' ? 'Success' : 'Failed'}\n\n`;
		status += `<i>Balance details are shown in check-in notifications.</i>\n`;
		status += `<i>Use /checkin to get latest balance.</i>`;

		return status;
	} catch (error) {
		return `Failed to get status: ${error.message}`;
	}
}

// Get check-in history
async function getHistory(env) {
	if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
		return 'GitHub configuration not set';
	}

	try {
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

		let history = `<b>Check-in History</b>\n`;
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

// Format time to readable string
function formatTime(isoString) {
	const date = new Date(isoString);
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${month}-${day} ${hours}:${minutes}`;
}
