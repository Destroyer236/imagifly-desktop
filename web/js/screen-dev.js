import { api } from './api.js';
import { S } from './store.js';
import * as UI from './ui.js';
import { icon } from './icons.js';
import { R } from './runtime.js';

const DEFAULT_MCP = `{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}`;

export async function renderDev(view) {
  const [keys, coverage, log] = await Promise.allSettled([
    api('/local/developer/api-keys'),
    api('/local/coverage'),
    api('/local/log'),
  ]);
  if (keys.status === 'fulfilled') S.dev.keys = keys.value;
  if (coverage.status === 'fulfilled') S.dev.coverage = coverage.value;
  if (log.status === 'fulfilled') S.dev.log = log.value;

  const keyList = normalizeKeys(S.dev.keys);
  const rows = S.dev.coverage || [];
  const stateCount = rows.reduce((acc, r) => ((acc[r.state] = (acc[r.state] || 0) + 1), acc), {});
  const checks = S.dev.selftest || [];
  const pass = checks.filter((c) => c.ok).length;

  view.innerHTML = `<div class="page">
    <div class="banner" style="margin-bottom:18px">${icon('code', 20)}<div><b>${rows.length} 项规范端点</b>全部有归属：${stateCount['已接入'] || 0} 项已接入界面，${stateCount['跳过'] || 0} 项按规范跳过，${stateCount['不调用'] || 0} 项服务端专用，${stateCount['已定义'] || 0} 项仅保留 API。这里还能跑公共接口自检、看上游请求日志、管理 API Key 与 MCP。</div></div>

    <div class="dev-grid">
      <section class="card pad-sm" style="padding:16px">
        <div class="sect-head" style="margin-bottom:8px"><div><div class="sect-title">API Key</div><div class="sect-sub">GET / POST / DELETE /api/developer/api-keys</div></div><button class="btn tonal sm" data-act="dev-key-create">${icon('plus', 16)}新建</button></div>
        <div class="list">${keyList.length ? keyList.map((k) => `<div class="list-row">
          <span class="ic">${icon('key', 18)}</span>
          <div class="main"><div class="t">${UI.esc(k.name || '未命名')}</div><div class="s">${UI.esc(k.keyPrefix || '')}… · 创建 ${UI.fmtDate(k.createdAt)}${k.lastUsedAt ? ' · 最近 ' + UI.timeAgo(k.lastUsedAt) : ''}</div></div>
          <button class="btn text xs" data-act="dev-key-delete" data-id="${UI.esc(k.id)}">删除</button>
        </div>`).join('') : UI.emptyState('key', '还没有 API Key', '创建后明文只显示一次，请立即保存。')}</div>
      </section>

      <section class="card pad-sm" style="padding:16px">
        <div class="sect-head" style="margin-bottom:8px"><div><div class="sect-title">MCP 控制台</div><div class="sect-sub">POST /api/mcp · Bearer imf_…</div></div><button class="btn tonal sm" data-act="dev-mcp-send">${icon('send', 16)}发送</button></div>
        <div class="field"><label>API Key</label><div class="field-box">${icon('key', 18)}<input id="mcpKey" placeholder="imf_…（不会保存在本地）"></div></div>
        <div class="field" style="margin-top:10px"><label>请求（JSON-RPC 2.0，method + params 会重新封装）</label><div class="field-box area"><textarea id="mcpBody" style="min-height:104px" spellcheck="false">${UI.esc(DEFAULT_MCP)}</textarea></div></div>
        <div id="mcpOut" class="code-box" style="margin-top:10px;max-height:240px">等待发送…</div>
      </section>
    </div>

    <section class="sect" style="margin-top:22px">
      ${UI.sectionHead('接口自检', '公共端点实机探测 · 每次运行都会重新请求上游', `<button class="btn ${checks.length ? 'tonal' : 'filled'} sm" data-act="dev-selftest">${icon('bolt', 16)}${checks.length ? '重新自检' : '运行自检'}</button>${checks.length ? `<span class="pill ${pass === checks.length ? 'ok' : 'warn'}">${pass}/${checks.length} 通过</span>` : ''}`)}
      <div class="card pad-sm" style="padding:8px 14px">${checks.length ? `<div class="list">${checks.map((c) => `<div class="list-row">
        <span class="pill ${c.ok ? 'ok' : 'err'}">${c.ok ? icon('check', 12) : icon('close', 12)}</span>
        <div class="main"><div class="t">${UI.esc(c.name)} <span class="mono muted" style="font-size:11px">${UI.esc(c.method)} ${UI.esc(c.path)}</span></div><div class="s">${UI.esc(c.detail)}</div></div>
        <span class="pill">${UI.esc(c.status)}</span><span class="num muted" style="font-size:11px">${UI.esc(c.duration)}</span>
      </div>`).join('')}</div>` : `<div class="field-help" style="padding:14px 4px">尚未运行。自检不涉及登录态，覆盖模型目录、社区流、套餐、注册时间戳等 14 项。</div>`}</div>
    </section>

    <section class="sect" style="margin-top:22px">
      ${UI.sectionHead(`${rows.length} 项接口覆盖`, '机器可读清单来自 internal/app/coverage.go', `<button class="icon-btn sm" data-act="dev-log-refresh" data-tip="刷新日志">${icon('refresh', 18)}</button>`)}
      <div class="chips" style="margin-bottom:10px">
        ${['全部', '已接入', '跳过', '不调用', '已定义'].map((s) => `<button class="chip ${(S.dev.filter || '全部') === s ? 'selected' : ''}" data-act="dev-coverage-filter" data-state="${s}">${s}${s === '全部' ? ` ${rows.length}` : ` ${stateCount[s] || 0}`}</button>`).join('')}
      </div>
      <div class="table-wrap">${coverageTable(rows)}</div>
    </section>

    <section class="sect" style="margin-top:22px">
      ${UI.sectionHead('上游请求日志', '最近 80 条 · 由 Go 客户端 Hook 记录', `<button class="btn text xs" data-act="dev-log-refresh">刷新</button>`)}
      <div class="table-wrap" id="logBox">${logTable(S.dev.log || [])}</div>
    </section>
  </div>`;
}

function normalizeKeys(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.keys || data.items || [];
}

function coverageTable(rows) {
  const filter = S.dev.filter || '全部';
  const list = filter === '全部' ? rows : rows.filter((r) => r.state === filter);
  if (!list.length) return `<div class="field-help">没有匹配的行。</div>`;
  return `<table class="cover-table"><thead><tr><th>#</th><th>方法</th><th>端点</th><th>客户端方法</th><th>界面</th><th>依据</th><th>状态</th><th>备注</th></tr></thead><tbody>
    ${list.map((r) => `<tr>
      <td class="num">${r.no}</td>
      <td><span class="pill mono">${UI.esc(r.method)}</span></td>
      <td class="mono">${UI.esc(r.path)}</td>
      <td class="mono">${UI.esc(r.client)}</td>
      <td>${UI.esc(r.ui)}</td>
      <td>${UI.esc(r.spec)}</td>
      <td><span class="pill ${r.state === '已接入' ? 'ok' : r.state === '跳过' || r.state === '不调用' ? '' : 'warn'}">${UI.esc(r.state)}</span></td>
      <td class="note">${UI.esc(r.note || '')}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

function logTable(entries) {
  if (!entries.length) return `<div class="field-help" style="padding:12px">还没有上游请求记录。</div>`;
  return `<table class="cover-table log-table"><thead><tr><th>时间</th><th>方法</th><th>路径</th><th>状态</th><th>耗时</th></tr></thead><tbody>
    ${entries.map((e) => `<tr>
      <td class="num">${UI.esc(e.time)}</td>
      <td><span class="pill mono">${UI.esc(e.method)}</span></td>
      <td class="mono">${UI.esc(e.path)}</td>
      <td><span class="pill ${e.status >= 200 && e.status < 400 ? 'ok' : e.status ? 'err' : ''}">${e.status || 'ERR'}</span></td>
      <td class="num">${e.ms} ms</td>
    </tr>`).join('')}
  </tbody></table>`;
}

async function createKey() {
  const name = await UI.promptSheet({ title: '新建 API Key', label: '名称', placeholder: '例如：本地脚本', confirm: '创建' });
  if (!name) return;
  try {
    const res = await api('/local/developer/api-keys', { method: 'POST', body: { name } });
    const plain = typeof res.key === 'string' ? res.key : res.plaintextKey || res.plaintext || res.secret || '';
    if (plain) {
      const sheet = UI.openSheet({
        title: 'API Key 已创建',
        subtitle: '明文只显示这一次',
        size: 'narrow',
        body: `<div class="code-box" id="newKey">${UI.esc(plain)}</div><div class="banner warn" style="margin-top:12px">${icon('warning', 20)}<div>请立即复制保存，离开此窗口后无法再次查看。</div></div>`,
        actions: `<button class="btn text" id="nk-close">关闭</button><button class="btn filled" id="nk-copy">${icon('copy', 18)}复制</button>`,
      });
      sheet.root.querySelector('#nk-close').onclick = () => sheet.close();
      sheet.root.querySelector('#nk-copy').onclick = async () => {
        const ok = await UI.copyText(plain);
        UI.toast(ok ? '已复制到剪贴板' : '复制失败', ok ? 'ok' : 'error');
      };
    } else {
      UI.toast('创建成功（响应里没有明文 Key）', 'ok');
    }
    S.dev.keys = await api('/local/developer/api-keys');
    renderDev(document.getElementById('view'));
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function deleteKey(id) {
  const ok = await UI.confirmSheet({ title: '删除 API Key', text: '删除后使用该 Key 的脚本与会话会立即失效。', confirm: '删除', danger: true });
  if (!ok) return;
  try {
    await api('/local/developer/api-keys/' + encodeURIComponent(id), { method: 'DELETE' });
    S.dev.keys = await api('/local/developer/api-keys');
    UI.toast('已删除', 'ok');
    renderDev(document.getElementById('view'));
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function sendMCP() {
  const key = document.getElementById('mcpKey')?.value.trim();
  const raw = document.getElementById('mcpBody')?.value || '';
  const out = document.getElementById('mcpOut');
  if (!key) return UI.toast('请填写 API Key（imf_ 前缀）', 'error');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return UI.toast('请求体不是合法 JSON', 'error');
  }
  out.textContent = '请求中…';
  try {
    const res = await api('/local/mcp', {
      method: 'POST',
      body: { key, method: parsed.method || 'tools/list', params: parsed.params, id: parsed.id ?? 1 },
    });
    out.textContent = UI.jsonPretty(res);
  } catch (e) {
    out.textContent = `请求失败：${e.message}${e.status ? `（HTTP ${e.status}）` : ''}`;
  }
}

async function selftest() {
  const view = document.getElementById('view');
  const btn = view?.querySelector('[data-act="dev-selftest"]');
  if (btn) btn.disabled = true;
  UI.toast('正在探测公共端点，约需 10–40 秒…');
  try {
    const res = await api('/local/selftest');
    S.dev.selftest = res.checks || [];
    const pass = S.dev.selftest.filter((c) => c.ok).length;
    UI.toast(`自检完成：${pass}/${S.dev.selftest.length} 通过`, pass === S.dev.selftest.length ? 'ok' : 'warn');
    await renderDev(view);
  } catch (e) {
    UI.toast(e.message, 'error');
    if (btn) btn.disabled = false;
  }
}

export const devActions = {
  'dev-key-create': createKey,
  'dev-key-delete': (d) => deleteKey(d.id),
  'dev-mcp-send': sendMCP,
  'dev-selftest': selftest,
  'dev-log-refresh': async () => {
    try {
      S.dev.log = await api('/local/log');
      const box = document.getElementById('logBox');
      if (box) box.innerHTML = logTable(S.dev.log);
      UI.toast('日志已刷新', 'ok');
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },
  'dev-coverage-filter': (d) => {
    S.dev.filter = d.state || '全部';
    renderDev(document.getElementById('view'));
  },
};
