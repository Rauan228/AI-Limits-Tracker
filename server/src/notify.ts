/**
 * Optional push channel: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to get
 * low-limit / reset / re-login alerts in Telegram. Without them alerts are
 * only kept in the in-app log.
 */
export async function notify(title: string, body: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `*${escapeMd(title)}*\n${escapeMd(body)}`, parse_mode: 'MarkdownV2' }),
    });
  } catch {
    // Alerts must never break a sync
  }
}

function escapeMd(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
