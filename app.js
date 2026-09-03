/**
 * AI 工作台 - 前端逻辑（双 API 模式）
 * 本地模式：直连本地 OpenAI 兼容服务（默认 LM Studio http://127.0.0.1:1234/v1，流式 SSE）
 * 云端模式：可配置的 OpenAI 兼容云端 API（Base URL 必须 https，含 DeepSeek 等预设，流式 SSE）
 * 支持：流式输出 / 多轮对话 / 模型列表自动拉取（本地）/ 停止生成 / 配置持久化（localStorage）
 */

// ============ 常量 ============
const DEFAULT_BASE = 'http://127.0.0.1:1234';
const STORAGE_KEY = 'ai-workbench-config';

// 云端预设（OpenAI 兼容服务）
const CLOUD_PRESETS = {
  deepseek: { base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  moonshot: { base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  zhipu: { base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  dashscope: { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  siliconflow: { base: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
};

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
  headerTitle: document.getElementById('headerTitle'),
  headerBadge: document.getElementById('headerBadge'),
  modeButtons: Array.from(document.querySelectorAll('.mode-btn')),
  localSettings: document.getElementById('localSettings'),
  cloudSettings: document.getElementById('cloudSettings'),
  cloudPreset: document.getElementById('cloudPreset'),
  cloudBase: document.getElementById('cloudBase'),
  cloudKey: document.getElementById('cloudKey'),
  cloudModel: document.getElementById('cloudModel'),
};

// ============ 状态 ============
let messages = [];            // 当前会话消息（不含 system）
let abortController = null;   // 用于停止生成
let streaming = false;        // 是否正在生成
let currentMode = 'local';    // local | cloud

// ============ 配置持久化 ============
function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.mode === 'cloud' || saved.mode === 'local') currentMode = saved.mode;
    if (saved.apiBase) els.apiBase.value = saved.apiBase;
    if (saved.apiKey) els.apiKey.value = saved.apiKey;
    if (saved.systemPrompt) els.systemPrompt.value = saved.systemPrompt;
    if (saved.cloudPreset) els.cloudPreset.value = saved.cloudPreset;
    if (saved.cloudBase) els.cloudBase.value = saved.cloudBase;
    if (saved.cloudKey) els.cloudKey.value = saved.cloudKey;
    if (saved.cloudModel) els.cloudModel.value = saved.cloudModel;
  } catch (e) { /* 忽略损坏的配置 */ }
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    mode: currentMode,
    apiBase: els.apiBase.value.trim(),
    apiKey: els.apiKey.value.trim(),
    systemPrompt: els.systemPrompt.value,
    cloudPreset: els.cloudPreset.value,
    cloudBase: els.cloudBase.value.trim(),
    cloudKey: els.cloudKey.value.trim(),
    cloudModel: els.cloudModel.value.trim(),
  }));
}

// ============ 工具函数 ============
function localBaseUrl() {
  return els.apiBase.value.trim().replace(/\/+$/, '');
}

function cloudEndpoint() {
  return els.cloudBase.value.trim().replace(/\/+$/, '') + '/chat/completions';
}

function cloudConfigured() {
  return !!(els.cloudBase.value.trim() && els.cloudKey.value.trim() && els.cloudModel.value.trim());
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

// 用 requestAnimationFrame 节流滚动，避免流式输出时频繁强制重排
let scrollRaf = null;
function scheduleScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    scrollToBottom();
  });
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
  // 换行由 CSS white-space: pre-wrap 处理，不再做正则替换
  return html;
}

// ============ 模式切换 ============
function applyModeUI(mode) {
  currentMode = mode;
  const isLocal = mode === 'local';
  els.localSettings.hidden = !isLocal;
  els.cloudSettings.hidden = isLocal;
  els.modeButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  if (isLocal) {
    els.headerTitle.textContent = '本地 AI 工作台';
    els.headerBadge.textContent = '本地 · OpenAI 兼容';
    els.status.textContent = '本地模式';
  } else {
    els.headerTitle.textContent = '云端 AI 工作台';
    els.headerBadge.textContent = '云端 · HTTPS';
    els.status.textContent = cloudConfigured() ? '云端模式' : '云端模式：请在左侧填写 Base URL / Key / 模型';
  }
  saveConfig();
}

// ============ 加载模型列表（本地模式） ============
async function loadModels() {
  els.status.textContent = '正在连接本地模型服务...';
  try {
    const res = await fetch(`${localBaseUrl()}/v1/models`, { signal: AbortSignal.timeout(8000) });
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
    els.status.textContent = `本地已加载 ${models.length} 个模型`;
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

// ============ 云端配置校验（未配置/不安全时给出清晰提示） ============
function validateCloudConfig() {
  const base = els.cloudBase.value.trim();
  const key = els.cloudKey.value.trim();
  const model = els.cloudModel.value.trim();
  if (!base) {
    return '尚未配置云端 API：请在左侧「云端 API」设置中填写 Base URL（https 开头）。';
  }
  if (!/^https:\/\//i.test(base)) {
    return '云端 Base URL 必须以 https:// 开头（云端请求强制走 https）。';
  }
  if (!key) {
    return '尚未配置云端 API Key：请在左侧「云端 API」设置中填写，或通过预设服务商快速填充。';
  }
  if (!model) {
    return '尚未配置云端模型名：请在左侧「云端 API」设置中填写，或选择一个预设服务商。';
  }
  return '';
}

// ============ 发送消息（流式） ============
async function sendMessage() {
  const text = els.userInput.value.trim();
  if (!text || streaming) return;

  // 云端模式：未配置或配置不安全时阻止发送并提示
  if (currentMode === 'cloud') {
    const cloudErr = validateCloudConfig();
    if (cloudErr) {
      const bubble = appendMessage('assistant', '');
      bubble.innerHTML = `<p class="error">${escapeHtml(cloudErr)}</p>`;
      els.status.textContent = '云端配置不完整';
      return;
    }
  }

  els.userInput.value = '';
  messages.push({ role: 'user', content: text });
  appendMessage('user', text);

  // 本地模式需要已加载模型；云端模式使用手填模型名
  let model = '';
  let url = '';
  let key = '';
  if (currentMode === 'local') {
    model = els.modelSelect.value;
    url = `${localBaseUrl()}/v1/chat/completions`;
    key = els.apiKey.value.trim();
    if (!model) {
      const bubble = appendMessage('assistant', '');
      bubble.innerHTML = `<p class="error">${escapeHtml('未选择模型：本地模式请先点击「刷新」加载模型，或切换到云端模式填写模型名。')}</p>`;
      els.status.textContent = '缺少模型';
      return;
    }
  } else {
    model = els.cloudModel.value.trim();
    url = cloudEndpoint();
    key = els.cloudKey.value.trim();
  }

  const sys = els.systemPrompt.value.trim();
  const body = {
    model: model,
    messages: sys ? [{ role: 'system', content: sys }, ...messages] : messages,
    stream: true,
    temperature: 0.7,
  };

  abortController = new AbortController();
  streaming = true;
  els.sendBtn.disabled = true;
  els.stopBtn.hidden = false;
  els.status.textContent = currentMode === 'cloud' ? '云端生成中...' : '本地生成中...';

  const bubble = appendMessage('assistant', '');
  const textNode = document.createTextNode('');
  bubble.appendChild(textNode);
  let assistantText = '';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
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
          const choice = json && json.choices && json.choices[0];
          const delta = (choice && choice.delta && choice.delta.content) || '';
          if (delta) {
            assistantText += delta;
            textNode.appendData(delta); // 增量追加文本，不触发全量重渲染
            scheduleScroll();
          }
        } catch (e) { /* 忽略非 JSON 数据 */ }
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
  const modeText = currentMode === 'cloud' ? '云端' : '本地';
  const engineText = currentMode === 'cloud' ? '云端 API' : '本地模型（LM Studio）';
  appendMessage('assistant', `你好，我是你的 ${modeText} AI 助手，当前使用 ${engineText}，有什么可以帮你？`);
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
els.cloudBase.addEventListener('change', saveConfig);
els.cloudKey.addEventListener('change', saveConfig);
els.cloudModel.addEventListener('change', saveConfig);
els.cloudPreset.addEventListener('change', () => {
  const preset = CLOUD_PRESETS[els.cloudPreset.value];
  if (preset) {
    els.cloudBase.value = preset.base;
    els.cloudModel.value = preset.model;
  }
  saveConfig();
});
els.modeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode === currentMode) return;
    applyModeUI(mode);
    if (mode === 'local' && !els.modelSelect.value) loadModels();
    newChat();
  });
});

// ============ 初始化 ============
loadConfig();
applyModeUI(currentMode);
newChat();
if (currentMode === 'local') {
  loadModels();
}
