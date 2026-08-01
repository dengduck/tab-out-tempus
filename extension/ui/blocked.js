import { MSG } from '../shared/messages.js';

const MESSAGE_BY_ACTION = Object.freeze({
  return: MSG.REQ_FOCUS_GUARD_RETURN,
  stop: MSG.REQ_FOCUS_GUARD_STOP,
  allow: MSG.REQ_FOCUS_GUARD_ALLOW,
});

const token = new URLSearchParams(location.search).get('token');
const buttons = [...document.querySelectorAll('[data-action]')];
const status = document.getElementById('status');

function setBusy(busy) {
  for (const button of buttons) button.disabled = busy;
}

async function sendAction(action) {
  if (!token || !MESSAGE_BY_ACTION[action]) return;
  setBusy(true);
  status.textContent = '';
  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_BY_ACTION[action],
      token,
    });
    if (!response?.ok) throw new Error(response?.error || '操作失败');
  } catch (err) {
    status.textContent = err?.message || '暂时无法完成操作，请重试。';
    setBusy(false);
  }
}

if (!token) {
  status.textContent = '阻止信息已失效，请返回上一页。';
  setBusy(true);
} else {
  for (const button of buttons) {
    button.addEventListener('click', () => sendAction(button.dataset.action));
  }
}
