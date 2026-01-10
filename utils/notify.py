import os
import smtplib
import time
from email.mime.text import MIMEText
from typing import Literal

import httpx


class TelegramFormatter:
	"""Telegram消息格式化工具"""

	EMOJI = {
		'robot': '🤖',
		'clock': '⏰',
		'chart': '📊',
		'success': '✅',
		'fail': '❌',
		'warning': '⚠️',
		'money': '💰',
		'stats': '📈',
		'photo': '📷',
		'line': '━' * 16,
	}

	@classmethod
	def format_checkin_message(
		cls,
		results: list[dict],
		success_count: int,
		total_count: int,
		execution_time: str,
		balance_changed: bool = False,
	) -> str:
		"""格式化签到结果消息"""
		lines = [
			f"{cls.EMOJI['robot']} <b>AnyRouter 签到通知</b>",
			'',
			f"{cls.EMOJI['clock']} 执行时间：{execution_time}",
			'',
			f"{cls.EMOJI['chart']} <b>签到结果</b>",
			cls.EMOJI['line'],
		]

		for result in results:
			status_emoji = cls.EMOJI['success'] if result.get('success') else cls.EMOJI['fail']
			account_name = result.get('name', 'Unknown')
			lines.append(f"{status_emoji} <b>{account_name}</b>")

			if result.get('quota') is not None:
				quota = result.get('quota', 0)
				used = result.get('used', 0)
				lines.append(f"   {cls.EMOJI['money']} 余额: ${quota} | 已用: ${used}")

			if result.get('error'):
				lines.append(f"   {cls.EMOJI['warning']} {result['error']}")

			lines.append('')

		lines.append(f"{cls.EMOJI['stats']} <b>统计汇总</b>")
		lines.append(cls.EMOJI['line'])
		lines.append(f"{cls.EMOJI['success']} 成功: {success_count}/{total_count}")

		if total_count - success_count > 0:
			lines.append(f"{cls.EMOJI['fail']} 失败: {total_count - success_count}/{total_count}")

		if balance_changed:
			lines.append(f"\n{cls.EMOJI['warning']} 检测到余额变化")

		return '\n'.join(lines)

	@classmethod
	def format_error_message(cls, error: str, context: str = '') -> str:
		"""格式化错误消息"""
		lines = [
			f"{cls.EMOJI['robot']} <b>AnyRouter 错误通知</b>",
			'',
			f"{cls.EMOJI['fail']} <b>发生错误</b>",
			cls.EMOJI['line'],
		]
		if context:
			lines.append(f"位置：{context}")
		lines.append(f"错误：{error}")
		return '\n'.join(lines)


class NotificationKit:
	def __init__(self):
		self.email_user: str = os.getenv('EMAIL_USER', '')
		self.email_pass: str = os.getenv('EMAIL_PASS', '')
		self.email_to: str = os.getenv('EMAIL_TO', '')
		self.email_sender: str = os.getenv('EMAIL_SENDER', '')
		self.smtp_server: str = os.getenv('CUSTOM_SMTP_SERVER', '')
		self.pushplus_token = os.getenv('PUSHPLUS_TOKEN')
		self.server_push_key = os.getenv('SERVERPUSHKEY')
		self.dingding_webhook = os.getenv('DINGDING_WEBHOOK')
		self.feishu_webhook = os.getenv('FEISHU_WEBHOOK')
		self.weixin_webhook = os.getenv('WEIXIN_WEBHOOK')
		self.gotify_url = os.getenv('GOTIFY_URL')
		self.gotify_token = os.getenv('GOTIFY_TOKEN')
		gotify_priority_env = os.getenv('GOTIFY_PRIORITY', '9')
		self.gotify_priority = int(gotify_priority_env) if gotify_priority_env.strip() else 9

		# Telegram配置
		self.telegram_bot_token = os.getenv('TELEGRAM_BOT_TOKEN')
		self.telegram_chat_ids = self._parse_chat_ids(os.getenv('TELEGRAM_CHAT_ID', ''))
		self.telegram_thread_id = os.getenv('TELEGRAM_THREAD_ID')
		self.telegram_silent = os.getenv('TELEGRAM_SILENT', 'false').lower() == 'true'
		self.telegram_notify_success = os.getenv('TELEGRAM_NOTIFY_SUCCESS', 'true').lower() == 'true'
		self.telegram_disable_preview = os.getenv('TELEGRAM_DISABLE_PREVIEW', 'true').lower() == 'true'
		self.telegram_retry_times = 3
		self.telegram_retry_delay = 2

	def _parse_chat_ids(self, chat_id_str: str) -> list[str]:
		"""解析Chat ID，支持逗号分隔多个"""
		if not chat_id_str:
			return []
		return [cid.strip() for cid in chat_id_str.split(',') if cid.strip()]

	def send_email(self, title: str, content: str, msg_type: Literal['text', 'html'] = 'text'):
		if not self.email_user or not self.email_pass or not self.email_to:
			raise ValueError('Email configuration not set')

		# 如果未设置 EMAIL_SENDER，使用 EMAIL_USER 作为默认值
		sender = self.email_sender if self.email_sender else self.email_user

		# MIMEText 需要 'plain' 或 'html'，而不是 'text'
		mime_subtype = 'plain' if msg_type == 'text' else 'html'
		msg = MIMEText(content, mime_subtype, 'utf-8')
		msg['From'] = f'AnyRouter Assistant <{sender}>'
		msg['To'] = self.email_to
		msg['Subject'] = title

		smtp_server = self.smtp_server if self.smtp_server else f'smtp.{self.email_user.split("@")[1]}'
		with smtplib.SMTP_SSL(smtp_server, 465) as server:
			server.login(self.email_user, self.email_pass)
			server.send_message(msg)

	def send_pushplus(self, title: str, content: str):
		if not self.pushplus_token:
			raise ValueError('PushPlus Token not configured')

		data = {'token': self.pushplus_token, 'title': title, 'content': content, 'template': 'html'}
		with httpx.Client(timeout=30.0) as client:
			client.post('http://www.pushplus.plus/send', json=data)

	def send_serverPush(self, title: str, content: str):
		if not self.server_push_key:
			raise ValueError('Server Push key not configured')

		data = {'title': title, 'desp': content}
		with httpx.Client(timeout=30.0) as client:
			client.post(f'https://sctapi.ftqq.com/{self.server_push_key}.send', json=data)

	def send_dingtalk(self, title: str, content: str):
		if not self.dingding_webhook:
			raise ValueError('DingTalk Webhook not configured')

		data = {'msgtype': 'text', 'text': {'content': f'{title}\n{content}'}}
		with httpx.Client(timeout=30.0) as client:
			client.post(self.dingding_webhook, json=data)

	def send_feishu(self, title: str, content: str):
		if not self.feishu_webhook:
			raise ValueError('Feishu Webhook not configured')

		data = {
			'msg_type': 'interactive',
			'card': {
				'elements': [{'tag': 'markdown', 'content': content, 'text_align': 'left'}],
				'header': {'template': 'blue', 'title': {'content': title, 'tag': 'plain_text'}},
			},
		}
		with httpx.Client(timeout=30.0) as client:
			client.post(self.feishu_webhook, json=data)

	def send_wecom(self, title: str, content: str):
		if not self.weixin_webhook:
			raise ValueError('WeChat Work Webhook not configured')

		data = {'msgtype': 'text', 'text': {'content': f'{title}\n{content}'}}
		with httpx.Client(timeout=30.0) as client:
			client.post(self.weixin_webhook, json=data)

	def send_gotify(self, title: str, content: str):
		if not self.gotify_url or not self.gotify_token:
			raise ValueError('Gotify URL or Token not configured')

		# 使用环境变量配置的优先级，默认为9
		priority = self.gotify_priority

		# 确保优先级在有效范围内 (1-10)
		priority = max(1, min(10, priority))

		data = {
			'title': title,
			'message': content,
			'priority': priority
		}

		url = f'{self.gotify_url}?token={self.gotify_token}'
		with httpx.Client(timeout=30.0) as client:
			client.post(url, json=data)

	def _telegram_request(self, method: str, data: dict = None, files: dict = None) -> dict:
		"""发送Telegram API请求，带重试机制"""
		if not self.telegram_bot_token:
			raise ValueError('Telegram Bot Token not configured')

		url = f'https://api.telegram.org/bot{self.telegram_bot_token}/{method}'
		last_error = None

		for attempt in range(self.telegram_retry_times):
			try:
				with httpx.Client(timeout=30.0) as client:
					if files:
						response = client.post(url, data=data, files=files)
					else:
						response = client.post(url, json=data)

					result = response.json()
					if result.get('ok'):
						return result
					else:
						error_desc = result.get('description', 'Unknown error')
						last_error = f"Telegram API error: {error_desc}"
						# 如果是权限或参数错误，不重试
						if response.status_code in [400, 401, 403]:
							raise ValueError(last_error)
			except httpx.TimeoutException:
				last_error = f"Request timeout (attempt {attempt + 1}/{self.telegram_retry_times})"
			except httpx.RequestError as e:
				last_error = f"Network error: {str(e)}"

			if attempt < self.telegram_retry_times - 1:
				time.sleep(self.telegram_retry_delay * (attempt + 1))  # 指数退避

		raise ValueError(last_error or 'Failed to send Telegram message')

	def send_telegram(self, title: str, content: str):
		"""发送Telegram文本消息"""
		if not self.telegram_chat_ids:
			raise ValueError('Telegram Chat ID not configured')

		message = f'<b>{title}</b>\n\n{content}'

		for chat_id in self.telegram_chat_ids:
			data = {
				'chat_id': chat_id,
				'text': message,
				'parse_mode': 'HTML',
				'disable_web_page_preview': self.telegram_disable_preview,
				'disable_notification': self.telegram_silent,
			}
			if self.telegram_thread_id:
				data['message_thread_id'] = int(self.telegram_thread_id)

			self._telegram_request('sendMessage', data)

	def send_telegram_photo(self, photo_path: str, caption: str = ''):
		"""发送Telegram图片消息（用于发送截图）"""
		if not self.telegram_chat_ids:
			raise ValueError('Telegram Chat ID not configured')

		for chat_id in self.telegram_chat_ids:
			data = {
				'chat_id': chat_id,
				'caption': caption,
				'parse_mode': 'HTML',
				'disable_notification': self.telegram_silent,
			}
			if self.telegram_thread_id:
				data['message_thread_id'] = int(self.telegram_thread_id)

			with open(photo_path, 'rb') as photo_file:
				files = {'photo': ('screenshot.png', photo_file, 'image/png')}
				self._telegram_request('sendPhoto', data=data, files=files)

	def send_telegram_enhanced(
		self,
		results: list[dict],
		success_count: int,
		total_count: int,
		execution_time: str,
		balance_changed: bool = False,
		screenshot_path: str = None,
	):
		"""发送增强版Telegram通知（带格式化和可选截图）"""
		if not self.telegram_chat_ids:
			raise ValueError('Telegram Chat ID not configured')

		# 检查是否需要发送通知
		all_success = success_count == total_count
		if all_success and not self.telegram_notify_success and not balance_changed:
			print('[Telegram]: All accounts successful, notification skipped (TELEGRAM_NOTIFY_SUCCESS=false)')
			return

		# 格式化消息
		message = TelegramFormatter.format_checkin_message(
			results=results,
			success_count=success_count,
			total_count=total_count,
			execution_time=execution_time,
			balance_changed=balance_changed,
		)

		# 发送消息到所有Chat ID
		for chat_id in self.telegram_chat_ids:
			data = {
				'chat_id': chat_id,
				'text': message,
				'parse_mode': 'HTML',
				'disable_web_page_preview': self.telegram_disable_preview,
				'disable_notification': self.telegram_silent,
			}
			if self.telegram_thread_id:
				data['message_thread_id'] = int(self.telegram_thread_id)

			self._telegram_request('sendMessage', data)

		# 如果有截图，发送截图
		if screenshot_path:
			try:
				import os
				print(f'[DEBUG] Attempting to send screenshot: {screenshot_path}')
				print(f'[DEBUG] Screenshot file exists: {os.path.exists(screenshot_path)}')
				caption = f"📷 签到页面截图\n⏰ {execution_time}"
				self.send_telegram_photo(screenshot_path, caption)
				print('[DEBUG] Screenshot sent successfully!')
			except Exception as e:
				print(f'[Telegram]: Failed to send screenshot: {str(e)}')

	def push_message(self, title: str, content: str, msg_type: Literal['text', 'html'] = 'text'):
		notifications = [
			('Email', lambda: self.send_email(title, content, msg_type)),
			('PushPlus', lambda: self.send_pushplus(title, content)),
			('Server Push', lambda: self.send_serverPush(title, content)),
			('DingTalk', lambda: self.send_dingtalk(title, content)),
			('Feishu', lambda: self.send_feishu(title, content)),
			('WeChat Work', lambda: self.send_wecom(title, content)),
			('Gotify', lambda: self.send_gotify(title, content)),
			('Telegram', lambda: self.send_telegram(title, content)),
		]

		for name, func in notifications:
			try:
				func()
				print(f'[{name}]: Message push successful!')
			except Exception as e:
				print(f'[{name}]: Message push failed! Reason: {str(e)}')


notify = NotificationKit()
