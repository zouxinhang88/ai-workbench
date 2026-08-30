/**
 * AI 工作台 - 前端逻辑
 * 通过 OpenAI 兼容 API 调用本地模型服务（默认 LM Studio: http://127.0.0.1:1234）
 * 支持：流式输出 / 多轮对话 / 模型列表自动拉取 / 停止生成 / 配置持久化
 */

// ============ 常量 ============
const DEFAULT_BASE = 'http://127.0.0.1:1234';
const STORAGE_KEY = 'ai-workbench-config';

// ============ DOM 引用 ============
const els = {
  apiBase: document.getElementById('apiBase'),
  apiKey: document.getElementById('apiKey'),
  modelSelect: document.getElementById('modelSelect'),
  refreshModels: document.getElementById('refreshModels'),
  systemPrompt: document.getElementById('systemPrompt'),
  newChat: document.getElementById('newChat'),
  chatBox: document.getElementById('chatBox'),
  userInput: document.getElementById('userInput'),
  sendBtn: document.getElementById('sendBtn'),
  stopBtn: document.getElementById('stopBtn'),
  status: document.getElementById('status'),
};

// ============ 状态 ============
let messages = [];            // 当前会话消息（不含 system）
let abortController = null;   // 用于停止生成
let streaming = false;        // 是否正在生成

// ============ 配置持久化 ============
function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.apiBase) els.apiBase.value = saved.apiBase;
    if (saved.apiKey) els.apiKey.value = saved.apiKey;
    if (saved.systemPrompt) els.systemPrompt.value = saved.systemPrompt;
  } catch (e) { /* 忽略损坏的配置 */ }
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    apiBase: els.apiBase.value.trim(),
    apiKey: els.apiKey.value.trim(),
    systemPrompt: els.systemPrompt.value,
  }));
}

// ============ 工具函数 ============
function baseUrl() {
  return els.apiBase.value.trim().replace(/\/+$/, '');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

function scrollToBottom() {
  els.chatBox.scrollTop = els.chatBox.scrollHeight;
}

// 轻量 Markdown 渲染（支持代码块、行内代码、标题、粗体、列表）
function renderMarkdown(text) {
  const esc = escapeHtml(text);
  // 代码块（先处理，避免块内内容被后续规则二次处理）
  let html = esc.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    return `<pre><code class="lang-${lang || 'text'}">${code}</code></pre>`;
  });
  // 行内代码
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // 标题
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  // 粗体
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 无序列表
  html = html.replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>');
  html = html.replace(/(?:<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  // 换行
  html = html.replace(/\n/g, '<br>');
  return html;
}

// ============ 加载模型列表 ============
async function loadModels() {
  els.status.textContent = '正在连接模型服务...';
  try {
    const res = await fetch(`${baseUrl()}/v1/models`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || []).map(m => m.id);

    els.modelSelect.innerHTML = '';
    if (models.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '（未找到模型）';
      els.modelSelect.appendChild(opt);
      els.status.textContent = '连接成功，但未发现已加载的模型';
      return;
    }
    models.forEach(id => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      els.modelSelect.appendChild(opt);
    });
    els.status.textContent = `已加载 ${models.length} 个模型`;
  } catch (err) {
    els.status.textContent = '连接失败：请确认本地模型服务已启动';
    els.modelSelect.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '（连接失败）';
    els.modelSelect.appendChild(opt);
  }
}

// ============ 消息渲染 ============
function appendMessage(role, content) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  if (role === 'user') {
    wrap.innerHTML = `<div class="bubble">${escapeHtml(content)}</div>`;
  } else {
    wrap.innerHTML = `<div class="bubble">${renderMarkdown(content)}</div>`;
  }
  els.chatBox.appendChild(wrap);
  scrollToBottom();
  return wrap.querySelector('.bubble');
}

// ============ 发送消息（流式） ============
async function sendMessage() {
  const text = els.userInput.value.trim();
  if (!text || streaming) return;

  els.userInput.value = '';
  messages.push({ role: 'user', content: text });
  appendMessage('user', text);

  const sys = els.systemPrompt.value.trim();
  const body = {
    model: els.modelSelect.value,
    messages: sys ? [{ role: 'system', content: sys }, ...messages] : messages,
    stream: true,
    temperature: 0.7,
  };

  abortController = new AbortController();
  streaming = true;
  els.sendBtn.disabled = true;
  els.stopBtn.hidden = false;
  els.status.textContent = '生成中...';

  const bubble = appendMessage('assistant', '');
  let assistantText = '';

  try {
    const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(els.apiKey.value.trim() ? { Authorization: `Bearer ${els.apiKey.value.trim()}` } : {}),
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status} ${errText.slice(0, 200)}`);
    }

    // 流式解析 SSE（data: 前缀的 JSON 行）
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 最后一行可能不完整，留到下一轮
      for (const line of lines) {
        const data = line.trim();
        if (!data.startsWith('data:')) continue;
        const payload = data.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            assistantText += delta;
            bubble.innerHTML = renderMarkdown(assistantText) + '<span class="cursor"></span>';
            scrollToBottom();
          }
        } catch { /* 忽略非 JSON 数据 */ }
      }
    }

    messages.push({ role: 'assistant', content: assistantText });
    bubble.innerHTML = renderMarkdown(assistantText);
    els.status.textContent = '完成';
  } catch (err) {
    if (err.name === 'AbortError') {
      if (assistantText) messages.push({ role: 'assistant', content: assistantText });
      bubble.innerHTML = renderMarkdown(assistantText) + '<p class="error">（已停止生成）</p>';
      els.status.textContent = '已停止';
    } else {
      bubble.innerHTML = `<p class="error">请求失败：${escapeHtml(err.message)}</p>`;
      els.status.textContent = '请求失败';
    }
  } finally {
    streaming = false;
    els.sendBtn.disabled = false;
    els.stopBtn.hidden = true;
    abortController = null;
  }
}

// ============ 新建对话 ============
function newChat() {
  messages = [];
  els.chatBox.innerHTML = '';
  appendMessage('assistant', '你好，我是你的本地 AI 助手，有什么可以帮你？');
  els.status.textContent = '新对话';
}

// ============ 事件绑定 ============
els.sendBtn.addEventListener('click', sendMessage);
els.stopBtn.addEventListener('click', () => abortController && abortController.abort());
els.refreshModels.addEventListener('click', () => { saveConfig(); loadModels(); });
els.newChat.addEventListener('click', newChat);
els.userInput.addEventListener('keydown', (e) => {
  // Enter 发送，Shift+Enter 换行
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
els.apiBase.addEventListener('change', saveConfig);
els.apiKey.addEventListener('change', saveConfig);
els.systemPrompt.addEventListener('change', saveConfig);

// ============ 初始化 ============
loadConfig();
newChat();
loadModels();
