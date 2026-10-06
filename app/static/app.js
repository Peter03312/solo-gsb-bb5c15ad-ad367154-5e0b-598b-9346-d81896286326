/* 脱敏文稿发布工作台 —— 原生 JS 单页前端（无任何第三方库/CDN）。 */
"use strict";

const $app = document.getElementById("app");
let me = null;
let current = { view: "todo", docId: null, versionId: null, pubId: null, detail: null };
let selection = null; // {start_cp, end_cp} 码位区间

/* ---------- 工具 ---------- */

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function api(method, url, body) {
  const opt = { method, headers: {}, credentials: "same-origin" };
  if (body !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  let resp;
  try {
    resp = await fetch(url, opt);
  } catch (e) {
    throw { status: 0, message: "无法连接服务器" };
  }
  let data = null;
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) data = await resp.json();
  if (!resp.ok) throw { status: resp.status, message: (data && data.error) || `请求失败（${resp.status}）` };
  return data;
}

let toastTimer = 0;
function toast(message, kind) {
  let box = document.getElementById("toast");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast";
    document.body.appendChild(box);
  }
  const item = document.createElement("div");
  item.className = `toast-item toast-${kind || "info"}`;
  item.textContent = message;
  box.appendChild(item);
  setTimeout(() => item.remove(), 4200);
}

function fmt(t) {
  if (!t) return "—";
  return String(t).replace("T", " ").slice(0, 16);
}

// 以 Unicode 码位为单位的字符串操作（正确处理 emoji 代理对/组合序列）。
function cpSlice(s, a, b) { return Array.from(s).slice(a, b).join(""); }
function cpLen(s) { return Array.from(s).length; }
function snippet(s, a, b) {
  let out = cpSlice(s, a, b);
  if (cpLen(out) > 24) out = cpSlice(out, 0, 24) + "…";
  return out;
}

/* ---------- 启动 ---------- */

async function boot() {
  try {
    me = await api("GET", "/api/auth/me");
  } catch (e) {
    me = null;
    renderLogin();
    return;
  }
  renderShell();
  go("todo");
}

function go(view, opts) {
  current = { view, docId: opts?.docId || null, versionId: opts?.versionId || null, pubId: opts?.pubId || null, detail: null };
  selection = null;
  document.querySelectorAll(".topbar nav button").forEach(b =>
    b.classList.toggle("active", b.dataset.view === view));
  if (view === "todo") renderTodo();
  else if (view === "documents") renderDocuments();
  else if (view === "new") renderNewDocument();
  else if (view === "pubs") renderPublications();
  else if (view === "publication") renderPublication(opts.pubId);
  else if (view === "doc") renderDocument(opts.docId);
  else if (view === "version") renderVersion(opts.docId, opts.versionId);
}

async function reloadCurrent() {
  if (current.view === "version") await renderVersion(current.docId, current.versionId, true);
  else if (current.view === "doc") await renderDocument(current.docId, true);
  else if (current.view === "todo") await renderTodo();
  else if (current.view === "documents") await renderDocuments();
  else if (current.view === "pubs") await renderPublications();
  else if (current.view === "publication") await renderPublication(current.pubId);
}

/* ---------- 登录页 ---------- */

function renderLogin() {
  $app.innerHTML = `
  <div class="login-wrap">
    <div class="panel">
      <h2>脱敏文稿发布工作台</h2>
      <div class="field">
        <label>用户名</label>
        <input type="text" id="login-user" autocomplete="username" placeholder="author / reviewer1 / reviewer2">
      </div>
      <div class="field">
        <label>密码</label>
        <input type="password" id="login-pass" autocomplete="current-password">
      </div>
      <button class="btn btn-primary" id="login-btn" style="width:100%">登录</button>
      <div class="hint-box">
        本地账号，无第三方服务。默认账号（可用环境变量修改）：<br>
        作者 <code class="k">author / author123</code><br>
        审阅人 <code class="k">reviewer1 / review123</code>、<code class="k">reviewer2 / review123</code>
      </div>
    </div>
  </div>`;
  const submit = async () => {
    const username = document.getElementById("login-user").value.trim();
    const password = document.getElementById("login-pass").value;
    if (!username || !password) return toast("请输入用户名和密码", "bad");
    try {
      await api("POST", "/api/auth/login", { username, password });
      boot();
    } catch (e) { toast(e.message, "bad"); }
  };
  document.getElementById("login-btn").addEventListener("click", submit);
  document.getElementById("login-pass").addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
}

/* ---------- 外壳顶栏 ---------- */

function renderShell() {
  const roleLabel = me.role === "author" ? "作者" : "审阅人";
  const authorNav = me.role === "author"
    ? `<button data-view="new">新建文稿</button>` : "";
  $app.innerHTML = `
  <header class="topbar">
    <span class="brand">🛡 脱敏发布工作台</span>
    <nav>
      <button data-view="todo">待办</button>
      <button data-view="documents">文稿与版本</button>
      ${authorNav}
      <button data-view="pubs">发布记录</button>
    </nav>
    <span class="spacer"></span>
    <span class="user">${esc(me.display_name)}<span class="role-tag">${roleLabel}</span></span>
    <button class="btn-logout" id="logout-btn">退出</button>
  </header>
  <main class="container" id="main"></main>`;
  $app.querySelector("nav").addEventListener("click", e => {
    const b = e.target.closest("button[data-view]");
    if (b) go(b.dataset.view);
  });
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await api("POST", "/api/auth/logout");
    location.reload();
  });
}

function mainEl() { return document.getElementById("main"); }
function setMain(html) { mainEl().innerHTML = html; }

/* ---------- 待办 ---------- */

async function renderTodo() {
  const [data, pubs] = await Promise.all([
    api("GET", "/api/todos"),
    me.role === "reviewer" ? api("GET", "/api/publications") : Promise.resolve([]),
  ]);
  const pendingRetractions = pubs.filter(p => p.can_confirm_retraction);
  const m = mainEl();
  if (me.role === "reviewer") {
    m.innerHTML = `
      <div class="panel">
        <h2>待我裁决（他人提议）</h2>
        ${data.awaiting_my_decision.length ? `
        <table><thead><tr><th>文稿</th><th>版本</th><th>提议人</th><th>选区（码位）</th><th></th></tr></thead><tbody>
        ${data.awaiting_my_decision.map(p => `
          <tr class="clickable" data-act="open-version" data-doc="${p.doc_id}" data-v="${p.version_id}">
            <td>${esc(p.document_title)}</td><td>v${p.version_no}</td>
            <td>${esc(p.proposer_name)}</td><td>[${p.start_cp}, ${p.end_cp})</td>
            <td><button class="btn btn-sm btn-primary">去裁决</button></td>
          </tr>`).join("")}
        </tbody></table>` : `<p class="muted">暂无待裁决提议。</p>`}
      </div>
      <div class="panel">
        <h2>我提出且未裁决的遮盖提议</h2>
        ${data.my_open_proposals.length ? `
        <table><thead><tr><th>文稿</th><th>版本</th><th>选区（码位）</th><th></th></tr></thead><tbody>
        ${data.my_open_proposals.map(p => `
          <tr class="clickable" data-act="open-version" data-doc="${p.doc_id}" data-v="${p.version_id}">
            <td>${esc(p.document_title)}</td><td>v${p.version_no}</td>
            <td>[${p.start_cp}, ${p.end_cp})</td>
            <td><button class="btn btn-sm">查看 / 撤回</button></td>
          </tr>`).join("")}
        </tbody></table>` : `<p class="muted">暂无进行中的提议。</p>`}
      </div>
      <div class="panel">
        <h2>待我确认的最终预览</h2>
        ${data.awaiting_my_confirmation.length ? `
        <table><thead><tr><th>文稿</th><th>版本</th><th>已有确认人数</th><th></th></tr></thead><tbody>
        ${data.awaiting_my_confirmation.map(v => `
          <tr>
            <td class="clickable" data-act="open-version" data-doc="${v.doc_id}" data-v="${v.version_id}">${esc(v.document_title)}</td>
            <td>v${v.version_no}</td><td>${v.confirmer_count} / 2</td>
            <td>
              <button class="btn btn-sm btn-ok" data-act="todo-confirm" data-v="${v.version_id}" data-rev="${v.state_rev}">确认</button>
              <button class="btn btn-sm" data-act="open-version" data-doc="${v.doc_id}" data-v="${v.version_id}">查看预览</button>
            </td>
          </tr>`).join("")}
        </tbody></table>` : `<p class="muted">没有待确认的版本（全部提议裁决后才需要确认）。</p>`}
      </div>
      <div class="panel">
        <h2>待我确认的撤稿</h2>
        ${pendingRetractions.length ? `
        <table><thead><tr><th>文稿</th><th>版本</th><th>发起人</th><th>撤稿原因</th><th></th></tr></thead><tbody>
        ${pendingRetractions.map(p => `
          <tr>
            <td class="clickable" data-act="open-publication" data-pid="${p.id}">${esc(p.document_title)}</td>
            <td>v${p.version_no}</td><td>${esc(p.retraction.requested_by_name)}</td>
            <td>${esc(p.retraction.reason)}</td>
            <td><button class="btn btn-sm btn-danger" data-act="open-publication" data-pid="${p.id}">查看快照并确认</button></td>
          </tr>`).join("")}
        </tbody></table>` : `<p class="muted">暂无待确认的撤稿申请。</p>`}
      </div>`;
  } else {
    const rows = data.ready_to_publish;
    m.innerHTML = `
      <div class="panel">
        <h2>可发布 / 等待确认的当前版本</h2>
        ${rows.length ? `
        <table><thead><tr><th>文稿</th><th>版本</th><th>非作者确认</th><th></th></tr></thead><tbody>
        ${rows.map(v => `
          <tr>
            <td class="clickable" data-act="open-version" data-doc="${v.doc_id}" data-v="${v.version_id}">${esc(v.document_title)}</td>
            <td>v${v.version_no}</td>
            <td>${v.confirmer_count >= 2 ? `<span class="badge badge-accepted">${v.confirmer_count} 人，可发布</span>`
              : `<span class="badge badge-pending">${v.confirmer_count} / 2 人确认</span>`}</td>
            <td>
              <button class="btn btn-sm btn-ok" data-act="todo-publish" data-v="${v.version_id}" data-rev="${v.state_rev}" ${v.confirmer_count < 2 ? "disabled" : ""}>发布</button>
              <button class="btn btn-sm" data-act="open-version" data-doc="${v.doc_id}" data-v="${v.version_id}">查看</button>
            </td>
          </tr>`).join("")}
        </tbody></table>` : `<p class="muted">暂无处理完所有提议的版本。</p>`}
      </div>`;
  }
}

/* ---------- 文稿列表 ---------- */

function documentStatusBadge(d) {
  if (!d.head_published_at) return '<span class="badge badge-pending">处理中</span>';
  if (d.head_retracted) return '<span class="badge badge-retracted">已撤稿</span>';
  return '<span class="badge badge-published">已发布</span>';
}

async function renderDocuments() {
  const docs = await api("GET", "/api/documents");
  setMain(`
  <div class="panel">
    <h2>文稿与版本</h2>
    ${docs.length ? `
    <table><thead><tr><th>标题</th><th>作者</th><th>当前版本</th><th>版本数</th><th>状态</th><th>创建时间</th></tr></thead><tbody>
    ${docs.map(d => `
      <tr class="clickable" data-act="open-doc" data-id="${d.id}">
        <td>${esc(d.title)}</td><td>${esc(d.author_name)}</td>
        <td>v${d.head_version_no || "-"}</td><td>${d.version_count}</td>
        <td>${documentStatusBadge(d)}</td>
        <td>${fmt(d.created_at)}</td>
      </tr>`).join("")}
    </tbody></table>` : `<p class="muted">还没有文稿。${me.role === "author" ? '点击顶部“新建文稿”开始。' : ""}</p>`}
  </div>`);
}

/* ---------- 新建文稿 ---------- */

function renderNewDocument() {
  if (me.role !== "author") { setMain(`<div class="panel"><p class="muted">仅作者可以新建文稿。</p></div>`); return; }
  setMain(`
  <div class="panel">
    <h2>新建文稿</h2>
    <p class="muted small">粘贴正文即创建第 1 个<strong>不可变版本</strong>；日后修改需另建版本，旧版本的批注不会沿用。</p>
    <div class="field"><label>标题</label><input type="text" id="doc-title" maxlength="200"></div>
    <div class="field"><label>正文（支持 emoji 等任意 Unicode 字符，选区按码位精确定位）</label>
      <textarea id="doc-content" placeholder="在此粘贴正文…"></textarea></div>
    <button class="btn btn-primary" id="create-doc-btn">创建（版本 v1）</button>
  </div>`);
  document.getElementById("create-doc-btn").addEventListener("click", async () => {
    const title = document.getElementById("doc-title").value.trim();
    const content = document.getElementById("doc-content").value;
    if (!title) return toast("标题不能为空", "bad");
    if (!content) return toast("正文不能为空", "bad");
    try {
      const r = await api("POST", "/api/documents", { title, content });
      toast("文稿已创建", "ok");
      go("version", { docId: r.id, versionId: r.head_version_id });
    } catch (e) { toast(e.message, "bad"); }
  });
}

/* ---------- 文稿详情（版本列表 + 新版本） ---------- */

function publicationVersionBadge(v) {
  if (!v.published_at) return "未发布";
  if (v.retraction_confirmed_at) return '<span class="badge badge-retracted">已撤稿</span>';
  if (v.retraction_reason) return '<span class="badge badge-pending">撤稿待确认</span>';
  return '<span class="badge badge-published">已发布</span>';
}

async function renderDocument(docId) {
  const doc = await api("GET", `/api/documents/${docId}`);
  const canCreate = me.role === "author" && me.id === doc.author_id;
  setMain(`
  <div class="panel">
    <h2>${esc(doc.title)}</h2>
    <p class="muted small">作者：${esc(doc.author_name)} ・ 创建于 ${fmt(doc.created_at)}</p>
  </div>
  ${canCreate ? `
  <div class="panel">
    <h3>另建新版本（修改正文）</h3>
    <p class="muted small">正文一经提交即成为新的不可变版本；旧版本及其提议、裁决、确认全部原样保留，<strong>不会沿用</strong>到新版本。</p>
    <div class="field"><textarea id="new-version-content" placeholder="粘贴修改后的完整正文…"></textarea></div>
    <button class="btn btn-primary" id="new-version-btn">基于当前正文创建新版本</button>
  </div>` : ""}
  <div class="panel">
    <h3>版本列表</h3>
    <table><thead><tr><th>版本</th><th>状态</th><th>待裁决</th><th>已接受</th><th>码位长度</th><th>创建时间</th></tr></thead><tbody>
    ${doc.versions.map(v => `
      <tr class="clickable" data-act="open-version" data-doc="${doc.id}" data-v="${v.id}">
        <td>v${v.version_no} ${v.id === doc.head_version_id ? '<span class="badge badge-head">当前</span>' : ""}</td>
        <td>${publicationVersionBadge(v)}</td>
        <td>${v.pending_count || 0}</td><td>${v.accepted_count || 0}</td>
        <td>${v.content_len}</td><td>${fmt(v.created_at)}</td>
      </tr>`).join("")}
    </tbody></table>
  </div>`);
  if (canCreate) {
    document.getElementById("new-version-btn").addEventListener("click", async () => {
      const content = document.getElementById("new-version-content").value;
      if (!content) return toast("正文不能为空", "bad");
      try {
        const r = await api("POST", `/api/documents/${docId}/versions`, { content });
        toast(`已创建版本 v${r.version_no}`, "ok");
        go("version", { docId, versionId: r.id });
      } catch (e) {
        toast(e.message, "bad");
        if (e.status === 409) renderDocument(docId);
      }
    });
    // 默认把当前版本正文带进输入框，方便小改
    try {
      const head = await api("GET", `/api/versions/${doc.head_version_id}`);
      document.getElementById("new-version-content").value = head.content;
    } catch (e) { /* ignore */ }
  }
}

/* ---------- 版本工作台 ---------- */

async function renderVersion(docId, vid, isReload) {
  const detail = await api("GET", `/api/versions/${vid}`);
  current.docId = docId;
  current.versionId = vid;
  current.detail = detail;
  selection = null;

  const doc = await api("GET", `/api/documents/${docId}`);
  const isReviewer = me.role === "reviewer";
  const canSelect = isReviewer && detail.is_head && !detail.published_at;

  const publicationStatus = detail.publication?.status;
  const statusBadge = publicationStatus === "retracted"
    ? `<span class="badge badge-retracted">已撤稿 ${fmt(detail.publication.retraction.confirmed_at)}</span>`
    : publicationStatus === "retraction_pending"
    ? `<span class="badge badge-pending">撤稿待确认</span>`
    : detail.published_at
    ? `<span class="badge badge-published">已发布 ${fmt(detail.published_at)}</span>`
    : detail.is_head ? `<span class="badge badge-head">当前版本</span>`
    : `<span class="badge badge-rejected">历史版本（只读）</span>`;

  setMain(`
  <div class="panel">
    <h2>${esc(detail.document_title)} · v${detail.version_no} ${statusBadge}</h2>
    <div class="ver-tabs">
      ${doc.versions.map(v => `
        <button class="ver-tab ${v.id === vid ? "active" : ""}"
          data-act="open-version" data-doc="${docId}" data-v="${v.id}">
          v${v.version_no}${v.retraction_confirmed_at ? " ⌫" : v.retraction_reason ? " ⏳" : v.published_at ? " ✓" : ""}
        </button>`).join("")}
    </div>
    <p class="muted small">正文长度：${detail.content_length} 个 Unicode 码位 ・ 裁决状态版本号 <code class="k">rev=${detail.state_rev}</code> ・ 创建于 ${fmt(detail.created_at)}
       <br>正文不可变；任何裁决/撤回/新提议都会使确认失效并推进 rev，过期提交将被拒绝并提示刷新。</p>
  </div>

  <div class="grid2">
    <div>
      <div class="panel">
        <h3>正文（选中文字提出遮盖）</h3>
        ${canSelect ? `<div class="notice notice-info small">在下方正文中拖选文字，范围以 Unicode 码位计算（emoji 按 1 个字符处理）。</div>`
          : detail.published_at ? `<div class="notice notice-ok small">该版本已发布，内容只读。</div>`
          : !detail.is_head ? `<div class="notice notice-warn small">这是历史版本，只能在当前版本上提出遮盖。</div>` : ""}
        <div class="sel-bar" id="sel-bar">
          <span class="small">已选码位区间 <b id="sel-range"></b></span>
          <input type="text" id="sel-reason" maxlength="500" placeholder="遮盖理由（可选）">
          <button class="btn btn-primary btn-sm" data-act="submit-proposal" data-v="${vid}">提交遮盖提议</button>
          <button class="btn btn-sm" id="sel-cancel">取消</button>
        </div>
        <pre class="source-pre" id="source-pre"></pre>
      </div>

      <div class="panel">
        <h3>遮盖提议（${detail.proposals.length}）</h3>
        <div id="proposal-list">${renderProposals(detail)}</div>
      </div>
    </div>

    <div>
      <div class="panel">
        <h3>遮盖预览（全部已接受范围的并集）</h3>
        <p class="muted small">范围重叠时只遮盖并集；每条提议仍保持独立裁决。连续被遮盖内容合并显示为 █。</p>
        <pre class="preview-pre">${esc(detail.masked_preview)}</pre>
        <p class="small muted">预览指纹 <code class="k">${detail.preview_sha.slice(0, 16)}…</code></p>
        <p>
          ${renderVersionExport(detail)}
          ${detail.pending_count > 0 ? `<span class="small" style="color:var(--warn)">（${detail.pending_count} 条未裁决，尚不能导出最终稿）</span>` : ""}
        </p>
      </div>

      <div class="panel" id="confirm-panel">
        ${renderConfirmPanel(detail)}
      </div>
    </div>
  </div>`);

  const pre = document.getElementById("source-pre");
  pre.textContent = detail.content; // 单文本节点，保证选区偏移可精确换算
  if (canSelect) {
    pre.addEventListener("mouseup", () => onSourceSelection(pre, detail));
    pre.addEventListener("keyup", e => { if (e.shiftKey) onSourceSelection(pre, detail); });
    document.getElementById("sel-cancel").addEventListener("click", () => {
      selection = null;
      document.getElementById("sel-bar").classList.remove("show");
      window.getSelection()?.removeAllRanges();
    });
  }
}

function renderVersionExport(detail) {
  if (detail.publication?.status === "retracted")
    return `<span class="badge badge-retracted">已撤稿，原导出入口已停用</span>
            <a class="btn btn-sm" data-act="open-publication" data-pid="${detail.publication.id}">查看历史快照</a>`;
  const note = detail.publication?.status === "retraction_pending"
    ? `<span class="small" style="color:var(--warn)">撤稿待确认；确认前仍可下载。</span>` : "";
  return `<a class="btn btn-sm" href="/api/versions/${detail.id}/export">⬇ 导出遮盖文本（仅含遮盖后内容）</a>${note}`;
}

function renderProposals(detail) {
  if (!detail.proposals.length) return `<p class="muted small">暂无提议。</p>`;
  const text = detail.content;
  return detail.proposals.map(p => {
    const decided = p.status !== "pending";
    const badge = {
      pending: `<span class="badge badge-pending">待裁决</span>`,
      accepted: `<span class="badge badge-accepted">已接受</span>`,
      rejected: `<span class="badge badge-rejected">已驳回</span>`,
      withdrawn: `<span class="badge badge-withdrawn">已撤回</span>`,
    }[p.status];
    let extra = "";
    if (p.status === "accepted" || p.status === "rejected")
      extra = `裁决人：${esc(p.adjudicator_name || "—")} ・ ${fmt(p.decided_at)}`;
    if (p.status === "withdrawn") extra = `撤回于 ${fmt(p.withdrawn_at)}`;
    return `
    <div class="proposal ${decided ? "decided" : ""}">
      <div class="meta">
        ${badge}
        <span>${esc(p.proposer_name)} 提议</span>
        <span class="muted small">[${p.start_cp}, ${p.end_cp}) 码位</span>
      </div>
      <div class="snippet">${esc(snippet(text, p.start_cp, p.end_cp))}</div>
      ${p.reason ? `<div class="small muted">理由：${esc(p.reason)}</div>` : ""}
      <div class="small muted">${extra || `提出于 ${fmt(p.created_at)}`}</div>
      <div class="row-actions">
        ${p.can_withdraw ? `<button class="btn btn-sm btn-danger" data-act="withdraw" data-id="${p.id}">撤回我的提议</button>` : ""}
        ${p.can_decide ? `
          <button class="btn btn-sm btn-ok" data-act="decide" data-id="${p.id}" data-decision="accepted">接受</button>
          <button class="btn btn-sm" data-act="decide" data-id="${p.id}" data-decision="rejected">驳回</button>` : ""}
        ${p.status === "pending" && !p.can_withdraw && !p.can_decide ? `<span class="small muted">等待另一名审阅人处理</span>` : ""}
      </div>
    </div>`;
  }).join("");
}

function renderConfirmPanel(detail) {
  const confs = detail.confirmations.map(c => `
    <li>${esc(c.reviewer_name)}
      ${c.matches_current ? '<span class="badge badge-accepted">有效</span>'
        : '<span class="badge badge-rejected">已失效（预览变化）</span>'}
      <span class="small muted">${fmt(c.created_at)}</span>
    </li>`).join("");
  const rev = detail.state_rev;
  let action = "";
  if (detail.publication?.status === "retracted") {
    const r = detail.publication.retraction;
    action = `<div class="notice notice-bad">
        此发布稿已撤稿（${fmt(r.confirmed_at)}）。撤稿不回滚版本或审阅结论；如需重新发布，请创建新版本并重新完成确认。
      </div>
      <div class="small muted">原因：${esc(r.reason)}<br>发起人：${esc(r.requested_by_name)} ・ 确认人：${esc(r.confirmed_by_name)}</div>
      <p><a class="btn btn-sm" data-act="open-publication" data-pid="${detail.publication.id}">查看保留的历史快照</a></p>`;
  } else if (detail.publication?.status === "retraction_pending") {
    const r = detail.publication.retraction;
    action = `<div class="notice notice-warn">
        撤稿申请待另一名非作者审阅人确认；确认前发布记录仍有效。
      </div>
      <div class="small muted">原因：${esc(r.reason)}<br>发起人：${esc(r.requested_by_name)} ・ ${fmt(r.requested_at)}</div>
      <p><a class="btn btn-sm" data-act="open-publication" data-pid="${detail.publication.id}">查看发布记录</a></p>`;
  } else if (detail.published_at) {
    action = `<div class="notice notice-ok">✅ 该版本已于 ${fmt(detail.published_at)} 发布，导出内容即为最终脱敏稿。</div>
      ${detail.publication?.can_request_retraction ? `<button class="btn btn-sm btn-danger" data-act="open-publication" data-pid="${detail.publication.id}">发起撤稿</button>` : ""}`;
  } else if (detail.pending_count > 0) {
    action = `<div class="notice notice-warn">尚有 ${detail.pending_count} 条提议未裁决；全部裁决后才能确认与发布。</div>`;
  } else if (me.role === "reviewer" && detail.can_confirm) {
    action = detail.my_confirmation
      ? `<div class="notice notice-ok">你已确认当前预览。若预览发生任何变化，确认将自动失效。</div>
         <button class="btn btn-sm" data-act="confirm" data-v="${detail.id}" data-rev="${rev}">重新确认当前预览</button>`
      : `<button class="btn btn-ok" data-act="confirm" data-v="${detail.id}" data-rev="${rev}">我确认这份最终预览</button>`;
  } else if (me.role === "author" && detail.is_head) {
    action = detail.can_publish
      ? `<button class="btn btn-ok" data-act="publish" data-v="${detail.id}" data-rev="${rev}">确认无误，发布脱敏稿</button>`
      : `<div class="notice notice-warn">确认不足：需要 <b>两名不同且非作者</b>的审阅人确认同一份最终预览（当前 ${detail.distinct_confirmers} 名）。</div>`;
  }
  return `
    <h3>最终预览确认（${detail.distinct_confirmers} / 2 名非作者审阅人）</h3>
    ${confs ? `<ul>${confs}</ul>` : `<p class="muted small">还没有人确认。</p>`}
    ${action}`;
}

/* 选区：浏览器 DOM 偏移(UTF-16) -> 码位偏移，与后端 Python str 下标一致。 */
function codePointOffset(pre, node, domOffset) {
  let cp = 0;
  const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
  let tn;
  while ((tn = walker.nextNode())) {
    if (tn === node) return cp + cpLen(tn.data.slice(0, domOffset));
    cp += cpLen(tn.data);
  }
  return cp;
}

function onSourceSelection(pre, detail) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!pre.contains(range.startContainer) || !pre.contains(range.endContainer)) return;
  let a = codePointOffset(pre, range.startContainer, range.startOffset);
  let b = codePointOffset(pre, range.endContainer, range.endOffset);
  if (a > b) [a, b] = [b, a];
  if (a === b) return;
  if (a < 0 || b > detail.content_length) {
    toast("非法选区：范围超出正文", "bad");
    return;
  }
  selection = { start_cp: a, end_cp: b };
  document.getElementById("sel-range").textContent = `[${a}, ${b})`;
  document.getElementById("sel-bar").classList.add("show");
}

/* ---------- 发布记录 ---------- */

function publicationBadge(p) {
  if (p.status === "retracted") return '<span class="badge badge-retracted">已撤稿</span>';
  if (p.status === "retraction_pending") return '<span class="badge badge-pending">撤稿待确认</span>';
  return '<span class="badge badge-published">可用</span>';
}

function publicationExportCell(p) {
  if (p.status === "retracted") return '<span class="small muted">已停用下载，可查看历史快照</span>';
  return `<a class="btn btn-sm" href="/api/versions/${p.version_id}/export">⬇ 导出脱敏文本</a>`;
}

async function renderPublications() {
  const rows = await api("GET", "/api/publications");
  setMain(`
  <div class="panel">
    <h2>发布记录</h2>
    ${rows.length ? `
    <table><thead><tr><th>状态</th><th>文稿</th><th>版本</th><th>发布人</th><th>发布时间</th><th>导出 / 记录</th></tr></thead><tbody>
    ${rows.map(r => `
      <tr>
        <td>${publicationBadge(r)}</td><td>${esc(r.document_title)}</td><td>v${r.version_no}</td>
        <td>${esc(r.published_by_name)}</td><td>${fmt(r.published_at)}</td>
        <td>
          ${publicationExportCell(r)}
          <button class="btn btn-sm" data-act="open-publication" data-pid="${r.id}">查看记录</button>
        </td>
      </tr>`).join("")}
    </tbody></table>` : `<p class="muted">暂无发布记录。</p>`}
  </div>`);
}

async function renderPublication(pid) {
  const p = await api("GET", `/api/publications/${pid}`);
  current.pubId = pid;
  current.detail = p;
  const r = p.retraction;
  const retractionPanel = r ? `
    <div class="panel ${r.status === "confirmed" ? "retracted-panel" : "pending-panel"}">
      <h3>${r.status === "confirmed" ? "撤稿记录" : "撤稿申请（待另一名非作者审阅人确认）"}</h3>
      <div class="retraction-meta">
        <span><b>原因：</b>${esc(r.reason)}</span>
        <span><b>发起人：</b>${esc(r.requested_by_name)} ・ ${fmt(r.requested_at)}</span>
        ${r.status === "confirmed"
          ? `<span><b>确认人：</b>${esc(r.confirmed_by_name)} ・ ${fmt(r.confirmed_at)}</span>`
          : `<span class="muted">作者不能自批；确认前此记录仍可下载。</span>`}
      </div>
      ${r.status === "confirmed"
        ? `<div class="notice notice-bad">已从当前可用发布稿移除；撤稿不回滚版本或审阅结论。重新发布必须创建新版本并重新完成原有审阅确认。</div>
           <button class="btn btn-sm" data-act="open-doc" data-id="${p.document_id}">去创建新版本以重新发布</button>`
        : ""}
      ${p.can_confirm_retraction ? `<button class="btn btn-danger" id="confirm-retraction-btn" data-sha="${r.snapshot_sha}">我已查看脱敏快照，确认撤稿</button>` : ""}
    </div>` : `
    <div class="panel">
      <h3>撤稿</h3>
      ${p.can_request_retraction ? `
        <p class="muted small">若发现已发布脱敏稿仍含敏感信息，请填写非空撤稿原因。提交后须由另一名非作者审阅人查看快照并确认。</p>
        <div class="field"><label>撤稿原因</label><textarea id="retraction-reason" maxlength="1000" placeholder="说明仍需撤稿的敏感信息风险"></textarea></div>
        <button class="btn btn-danger" id="request-retraction-btn">发起撤稿</button>`
        : `<p class="muted">只有文稿作者可对可用发布记录发起撤稿。</p>`}
    </div>`;

  setMain(`
  <div class="panel">
    <h2>${publicationBadge(p)} ${esc(p.document_title)} · v${p.version_no}</h2>
    <p class="muted small">
      发布人：${esc(p.published_by_name)} ・ 发布于 ${fmt(p.published_at)} ・
      快照指纹 <code class="k">${esc(p.snapshot_sha)}</code>
    </p>
    <p>
      <button class="btn btn-sm" data-act="open-version" data-doc="${p.document_id}" data-v="${p.version_id}">查看版本工作台</button>
      ${p.available ? `<a class="btn btn-sm" href="/api/versions/${p.version_id}/export">⬇ 导出此发布稿</a>`
        : '<span class="badge badge-retracted">原导出入口不可用</span>'}
    </p>
  </div>
  ${retractionPanel}
  <div class="panel">
    <h3>发布时脱敏快照（仅含遮盖后内容）</h3>
    <pre class="preview-pre">${esc(p.masked_text)}</pre>
    <p class="small muted">快照长度：${p.masked_text_length} 个 Unicode 码位。历史记录保留供登录用户追溯，页面任何情况下都不展示原文。</p>
  </div>`);

  const reqBtn = document.getElementById("request-retraction-btn");
  if (reqBtn) {
    reqBtn.addEventListener("click", async () => {
      const reason = document.getElementById("retraction-reason").value.trim();
      if (!reason) return toast("撤稿原因不能为空", "bad");
      await mutate("POST", `/api/publications/${pid}/retraction`, { reason },
        "撤稿申请已发起，等待另一名非作者审阅人确认",
        { after: async () => renderPublication(pid), stale: async () => renderPublication(pid) });
    });
  }
  const conBtn = document.getElementById("confirm-retraction-btn");
  if (conBtn) {
    conBtn.addEventListener("click", async () => {
      await mutate("POST", `/api/publications/${pid}/retraction/confirm`,
        { snapshot_sha: conBtn.dataset.sha }, "已确认撤稿，发布记录已标记为撤稿",
        { after: async () => renderPublication(pid), stale: async () => renderPublication(pid) });
    });
  }
}

/* ---------- 统一操作处理 ---------- */

async function mutate(method, url, body, okMsg, opts) {
  try {
    const r = await api(method, url, body);
    if (okMsg) toast(okMsg, "ok");
    if (opts?.after) await opts.after(r);
  } catch (e) {
    toast(e.message, "bad");
    if (e.status === 409 && opts?.stale) await opts.stale();
  }
}

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;

  if (act === "open-doc") {
    e.preventDefault();
    go("doc", { docId: Number(el.dataset.id) });
  } else if (act === "open-version") {
    e.preventDefault();
    go("version", { docId: Number(el.dataset.doc), versionId: Number(el.dataset.v) });
  } else if (act === "open-publication") {
    e.preventDefault();
    go("publication", { pubId: Number(el.dataset.pid) });
  } else if (act === "submit-proposal") {
    e.preventDefault();
    if (!selection) return toast("请先在正文中拖选要遮盖的文字", "bad");
    const reason = document.getElementById("sel-reason").value;
    const rev = current.detail.state_rev;
    await mutate("POST", `/api/versions/${el.dataset.v}/proposals`,
      { start_cp: selection.start_cp, end_cp: selection.end_cp, reason, expected_rev: rev },
      "提议已提交，等待另一名审阅人裁决",
      { after: async () => renderVersion(current.docId, current.versionId),
        stale: async () => renderVersion(current.docId, current.versionId) });
  } else if (act === "withdraw") {
    e.preventDefault();
    const rev = current.detail.state_rev;
    await mutate("POST", `/api/proposals/${el.dataset.id}/withdraw`, { expected_rev: rev },
      "已撤回该提议",
      { after: async () => renderVersion(current.docId, current.versionId),
        stale: async () => renderVersion(current.docId, current.versionId) });
  } else if (act === "decide") {
    e.preventDefault();
    const rev = current.detail.state_rev;
    const word = el.dataset.decision === "accepted" ? "接受" : "驳回";
    await mutate("POST", `/api/proposals/${el.dataset.id}/decide`,
      { decision: el.dataset.decision, expected_rev: rev }, `已${word}该提议`,
      { after: async () => renderVersion(current.docId, current.versionId),
        stale: async () => renderVersion(current.docId, current.versionId) });
  } else if (act === "confirm") {
    e.preventDefault();
    await mutate("POST", `/api/versions/${el.dataset.v}/confirm`, { expected_rev: Number(el.dataset.rev) },
      "已确认最终预览",
      { after: async () => renderVersion(current.docId || (await inferDoc(Number(el.dataset.v))), Number(el.dataset.v)),
        stale: async () => { toast("状态已过期，已为你刷新", "info"); await renderVersion(current.docId, Number(el.dataset.v)); } });
  } else if (act === "publish") {
    e.preventDefault();
    await mutate("POST", `/api/versions/${el.dataset.v}/publish`, { expected_rev: Number(el.dataset.rev) },
      "🎉 脱敏稿已发布",
      { after: async () => renderVersion(current.docId, Number(el.dataset.v)),
        stale: async () => renderVersion(current.docId, Number(el.dataset.v)) });
  } else if (act === "todo-confirm") {
    e.preventDefault();
    const vid = Number(el.dataset.v);
    const docId = await inferDoc(vid);
    await mutate("POST", `/api/versions/${vid}/confirm`, { expected_rev: Number(el.dataset.rev) },
      "已确认最终预览",
      { after: async () => { await renderTodo(); toast("可在版本页查看", "info"); },
        stale: async () => renderTodo() });
  } else if (act === "todo-publish") {
    e.preventDefault();
    const vid = Number(el.dataset.v);
    await mutate("POST", `/api/versions/${vid}/publish`, { expected_rev: Number(el.dataset.rev) },
      "🎉 脱敏稿已发布",
      { after: async () => renderTodo(), stale: async () => renderTodo() });
  }
});

async function inferDoc(vid) {
  const v = await api("GET", `/api/versions/${vid}`);
  return v.document_id;
}

boot();
