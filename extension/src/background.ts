import { syncAll, updateBadge } from './core';

const ALARM = 'ai-limits-refresh';

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 10 });
  syncAll().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  syncAll().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) syncAll().catch(() => {});
});

// The popup asks for an on-demand refresh
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'refresh') {
    syncAll()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
  if (msg?.type === 'badge') {
    updateBadge().finally(() => sendResponse({ ok: true }));
    return true;
  }
});
