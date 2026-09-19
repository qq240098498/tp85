// 页面交互：项目清单与依赖登记都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  projects: [],
  deps: [],
  licenses: [],
  statuses: [],
  editingId: '',
};

const el = (id) => document.getElementById(id);

// 统一的请求入口：出错时把服务端给的错误码、说明与出错位置一起抛出去
async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function notify(message, kind) {
  const box = el('notice');
  box.textContent = message;
  box.className = `notice ${kind === 'ok' ? 'ok' : 'error'}`;
}

function clearNotice() {
  const box = el('notice');
  box.className = 'notice hidden';
  box.textContent = '';
}

function clearFieldMarks() {
  document.querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
}

// 把出错位置标到具体输入项上：项目区与依赖区共用一套标记
function markField(field) {
  if (!field) return;
  const target = document.querySelector(`[data-field="${field}"]`);
  if (!target) return;
  target.classList.add('invalid');
  const input = target.tagName === 'INPUT' || target.tagName === 'SELECT' ? target : target.querySelector('input, select');
  if (input) input.focus();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 操作者名字记在浏览器里，刷新之后还在，保存时随请求一起带上
const OPERATOR_KEY = 'dep-ledger-operator';

function currentOperator() {
  return el('operator').value.trim();
}

function restoreOperator() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
}

async function loadHealth() {
  try {
    await request('/api/health');
    el('health').textContent = '服务正常';
    el('health').className = 'health ok';
  } catch (err) {
    el('health').textContent = '服务连不上';
    el('health').className = 'health bad';
  }
}

async function loadProjects() {
  const payload = await request('/api/projects');
  state.projects = payload.projects || [];
  renderProjects();
  renderProjectOptions();
}

async function loadDeps() {
  const params = new URLSearchParams();
  const projectId = el('filter-project').value;
  const status = el('filter-status').value;
  const license = el('filter-license').value;
  const keyword = el('filter-keyword').value.trim();
  if (projectId) params.set('projectId', projectId);
  if (status) params.set('status', status);
  if (license) params.set('license', license);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/deps${query ? `?${query}` : ''}`);
  state.deps = payload.deps || [];
  state.licenses = payload.licenses || [];
  state.statuses = payload.statuses || [];
  renderDepFilterOptions();
  renderDeps();
}

function renderProjects() {
  const body = el('project-body');
  body.innerHTML = state.projects.map((item) => `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.owner) || '<span class="missing">未指定</span>'}</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td>${item.depCount} 条</td>
      <td class="mono">${escapeHtml(formatTime(item.createdAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-project-rename="${escapeHtml(item.id)}">改名</button>
        <button type="button" class="link" data-project-owner="${escapeHtml(item.id)}">改负责人</button>
        <button type="button" class="link danger" data-project-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('project-empty').classList.toggle('hidden', state.projects.length > 0);
}

function renderProjectOptions() {
  const select = el('dep-project');
  const current = select.value;
  select.innerHTML = state.projects
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join('');
  if (state.projects.some((item) => item.id === current)) select.value = current;

  const filter = el('filter-project');
  const filterCurrent = filter.value;
  filter.innerHTML = '<option value="">全部项目</option>'
    + state.projects.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  if (state.projects.some((item) => item.id === filterCurrent)) filter.value = filterCurrent;
}

function renderDepFilterOptions() {
  const statusSelect = el('filter-status');
  const statusCurrent = statusSelect.value;
  statusSelect.innerHTML = '<option value="">全部状态</option>'
    + state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(statusCurrent)) statusSelect.value = statusCurrent;

  const licenseSelect = el('filter-license');
  const licenseCurrent = licenseSelect.value;
  licenseSelect.innerHTML = '<option value="">全部许可</option>'
    + state.licenses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.licenses.includes(licenseCurrent)) licenseSelect.value = licenseCurrent;

  const statusForm = el('dep-status');
  const statusFormCurrent = statusForm.value;
  statusForm.innerHTML = state.statuses
    .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
    .join('');
  if (state.statuses.includes(statusFormCurrent)) statusForm.value = statusFormCurrent;
}

function projectName(projectId) {
  const found = state.projects.find((item) => item.id === projectId);
  return found ? found.name : projectId;
}

function renderDeps() {
  const body = el('dep-body');
  body.innerHTML = state.deps.map((item) => {
    const statusTag = item.status === '已弃用' ? 'off' : 'on';
    return `<tr>
      <td>${escapeHtml(projectName(item.projectId))}</td>
      <td class="mono">${escapeHtml(item.name)}</td>
      <td class="mono">${escapeHtml(item.version)}</td>
      <td>${item.license ? escapeHtml(item.license) : '<span class="missing">未填</span>'}</td>
      <td>${item.owner ? escapeHtml(item.owner) : '<span class="missing">未指定</span>'}</td>
      <td><span class="tag ${statusTag}">${escapeHtml(item.status)}</span></td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-dep-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-dep-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`;
  }).join('');
  el('dep-empty').classList.toggle('hidden', state.deps.length > 0);
}

function openDepForm(dep) {
  state.editingId = dep ? dep.id : '';
  el('dep-form-title').textContent = dep ? `编辑登记：${dep.name}` : '新建登记';
  if (state.projects.length) {
    el('dep-project').value = dep ? dep.projectId : state.projects[0].id;
  }
  el('dep-name').value = dep ? dep.name : '';
  el('dep-version').value = dep ? dep.version : '';
  el('dep-license').value = dep ? dep.license : '';
  el('dep-owner').value = dep ? dep.owner : currentOperator();
  el('dep-status').value = dep ? dep.status : (state.statuses[0] || '在用');
  el('dep-note').value = dep ? dep.note : '';
  el('dep-form').classList.remove('hidden');
  el('dep-name').focus();
}

function closeDepForm() {
  state.editingId = '';
  el('dep-form').classList.add('hidden');
  clearFieldMarks();
}

async function submitProject(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    name: el('project-name').value,
    owner: el('project-owner').value,
    note: el('project-note').value,
  };
  try {
    await request('/api/projects', { method: 'POST', body: JSON.stringify(payload) });
    el('project-name').value = '';
    el('project-owner').value = '';
    el('project-note').value = '';
    notify('项目已新增', 'ok');
    await loadProjects();
    await loadDeps();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitDep(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    projectId: el('dep-project').value,
    name: el('dep-name').value,
    version: el('dep-version').value,
    license: el('dep-license').value,
    owner: el('dep-owner').value,
    status: el('dep-status').value,
    note: el('dep-note').value,
  };
  const editing = state.editingId;
  try {
    if (editing) {
      await request(`/api/deps/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('依赖登记已保存', 'ok');
    } else {
      await request('/api/deps', { method: 'POST', body: JSON.stringify(payload) });
      notify('依赖登记已新增', 'ok');
    }
    closeDepForm();
    await loadProjects();
    await loadDeps();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 列表上的操作用事件委托统一处理，列表重绘之后不需要重新绑定
document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;

  const projectId = node.dataset.projectRename || node.dataset.projectOwner || node.dataset.projectDelete;
  if (projectId) {
    clearNotice();
    const found = state.projects.find((item) => item.id === projectId);
    if (!found) return;
    try {
      if (node.dataset.projectRename) {
        const next = window.prompt(`把 ${found.name} 的名称改成`, found.name);
        if (next === null) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify({ name: next }) });
        notify('项目名称已更新', 'ok');
      } else if (node.dataset.projectOwner) {
        const next = window.prompt(`把 ${found.name} 的负责人改成`, found.owner || '');
        if (next === null) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify({ owner: next }) });
        notify('项目负责人已更新', 'ok');
      } else {
        if (!window.confirm(`确定删除项目 ${found.name} 吗？`)) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
        notify('项目已删除', 'ok');
      }
      await loadProjects();
      await loadDeps();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.depEdit) {
    clearNotice();
    const found = state.deps.find((item) => item.id === node.dataset.depEdit);
    if (found) openDepForm(found);
    return;
  }

  if (node.dataset.depDelete) {
    clearNotice();
    const found = state.deps.find((item) => item.id === node.dataset.depDelete);
    if (!window.confirm(`确定删除登记 ${found ? found.name : ''} 吗？`)) return;
    try {
      await request(`/api/deps/${encodeURIComponent(node.dataset.depDelete)}`, { method: 'DELETE' });
      if (state.editingId === node.dataset.depDelete) closeDepForm();
      notify('登记已删除', 'ok');
      await loadProjects();
      await loadDeps();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
});

// ---- 批量导入 ------------------------------------------------------------
// 文件与粘贴内容都在页面上先解析成一组对象，再交给后端按同一套口径预演，
// 页面本身不做字段是否成立的判断，避免与服务端口径不一致
const importState = {
  items: [],
  preview: null,
};

const SAMPLE_IMPORT = [
  '项目名称,依赖名称,版本,许可,责任人,状态,备注',
  '订单服务,guava,32.1.0,Apache-2.0,陈晓,在用,通用工具库',
  '订单服务,spring-boot,2.7.18,Apache-2.0,陈晓,在用,已经登记过，预演会标出来',
  '会员侧,new-dep,1.0.0,MIT,王凯,在用,项目名称没有登记过',
  '会员中心,Bad_Name,1.0.0,MIT,王凯,在用,依赖名称写法不合规',
  '会员中心,lodash,4.17, MIT,王凯,在用,版本不是三段数字',
  '会员中心,axios,1.6.2,MIT,王凯,停用,状态取值不认识',
  '支付网关,netty,4.1.100,Apache-2.0,李文,在用,批内重复',
  '支付网关,netty,4.1.100,Apache-2.0,李文,待升,同一次导入里同项目同名',
].join('\n');

// 带引号的 CSV/TSV 解析：引号里可以出现分隔符、换行，两个双引号表示一个双引号
function parseDelimited(text) {
  const delimiter = text.includes('\t') ? '\t' : ',';
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === '\n') {
      pushField(); pushRow();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      pushField(); pushRow();
    } else {
      field += ch;
    }
  }
  pushField();
  if (row.length > 1 || row[0] !== '') pushRow();

  const table = rows
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ''));
  if (table.length < 2) {
    throw new Error('第一行要写表头，从第二行起每条一行，至少要有项目名称、依赖名称、版本三列');
  }
  const headers = table[0];
  return table.slice(1).map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      if (header) record[header] = cells[index] || '';
    });
    return record;
  });
}

// 粘贴/文件内容先按 JSON 试，解析不了再按带表头的分隔文本处理
function parseImportText(text) {
  const content = text.trim();
  if (!content) throw new Error('请先选择文件或把清单内容粘进来');
  if (content[0] === '[' || content[0] === '{') {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error('内容以 [ 或 { 开头但不是合法 JSON，请检查格式');
    }
    const items = Array.isArray(parsed) ? parsed : (parsed.items || parsed.deps);
    if (!Array.isArray(items) || !items.length) {
      throw new Error('JSON 里没有读到条目数组，请传 [{ "项目名称": "...", "依赖名称": "...", "版本": "..." }] 这样的结构');
    }
    return items;
  }
  return parseDelimited(content);
}

function renderImportPreview(preview) {
  const box = el('import-result');
  const summary = `<div class="import-summary">
      <span class="pill total">共 ${preview.total} 条</span>
      <span class="pill ok">可导入 ${preview.importable} 条</span>
      <span class="pill warn">与已有登记同名 ${preview.existing} 条</span>
      <span class="pill bad">不成立 ${preview.invalid} 条</span>
    </div>`;

  const rows = preview.results.map((item) => {
    const n = item.normalized;
    let verdict;
    if (!item.valid) verdict = '<span class="tag bad">不成立</span>';
    else if (item.exists) verdict = '<span class="tag warn">已有同名</span>';
    else verdict = '<span class="tag ok">可导入</span>';
    const rowClass = !item.valid ? ' class="row-bad"' : (item.exists ? ' class="row-exists"' : '');
    const notes = item.problems.length
      ? item.problems.map((problem) => `<li>${escapeHtml(problem.message)}</li>`).join('')
      : '<li>校验通过，可以导入</li>';
    return `<tr${rowClass}>
      <td class="mono">${item.line}</td>
      <td>${escapeHtml(n.projectName) || '<span class="missing">未填</span>'}</td>
      <td class="mono">${escapeHtml(n.name) || '<span class="missing">未填</span>'}</td>
      <td class="mono">${escapeHtml(n.version) || '<span class="missing">未填</span>'}</td>
      <td>${escapeHtml(n.status)}</td>
      <td>${verdict}</td>
      <td class="import-problems"><ul>${notes}</ul></td>
    </tr>`;
  }).join('');

  box.innerHTML = `${summary}
    <div class="table-wrap">
      <table class="grid import-grid">
        <thead><tr><th>#</th><th>项目</th><th>依赖名称</th><th>版本</th><th>状态</th><th>结论</th><th>说明</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="form-actions">
      <button type="button" id="import-confirm"${preview.importable ? '' : ' disabled'}>确认导入 ${preview.importable} 条</button>
      <button type="button" id="import-revise" class="ghost">返回修改</button>
    </div>
    <p class="import-tip">与已有登记同名的条目会自动跳过，不会覆盖现有登记；不成立的条目请改好后重新预演。</p>`;
  box.classList.remove('hidden');
}

async function runImportPreview() {
  clearNotice();
  let items;
  try {
    items = parseImportText(el('import-text').value);
  } catch (err) {
    importState.items = [];
    importState.preview = null;
    el('import-result').classList.add('hidden');
    notify(err.message, 'error');
    return;
  }
  try {
    const preview = await request('/api/deps/import-preview', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
    importState.items = items;
    importState.preview = preview;
    renderImportPreview(preview);
    if (!preview.importable) notify('预演完成：没有可以导入的条目，请按下面的说明修改', 'error');
    else notify(`预演完成：${preview.importable} 条可以导入，确认后才会写入`, 'ok');
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function confirmImport() {
  if (!importState.items.length) return;
  if (!window.confirm(`确认把预演通过的条目导入吗？与已有登记同名或不成立的条目会自动跳过。`)) return;
  try {
    const result = await request('/api/deps/import', {
      method: 'POST',
      body: JSON.stringify({ items: importState.items }),
    });
    el('import-result').classList.add('hidden');
    el('import-box').classList.add('hidden');
    el('import-text').value = '';
    el('import-filename').textContent = '';
    importState.items = [];
    importState.preview = null;
    notify(`导入完成：新增 ${result.imported} 条${result.skipped ? `，跳过 ${result.skipped} 条` : ''}`, 'ok');
    await loadProjects();
    await loadDeps();
  } catch (err) {
    notify(err.message, 'error');
  }
}

el('dep-import').addEventListener('click', () => {
  clearNotice();
  el('import-box').classList.toggle('hidden');
  if (!el('import-box').classList.contains('hidden')) el('import-text').focus();
});
el('import-close').addEventListener('click', () => {
  el('import-box').classList.add('hidden');
});
el('import-file').addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    el('import-text').value = String(reader.result || '');
    el('import-filename').textContent = `已读入文件：${file.name}`;
    el('import-result').classList.add('hidden');
  };
  reader.onerror = () => notify(`读文件失败：${file.name}`, 'error');
  reader.readAsText(file, 'utf8');
});
el('import-sample').addEventListener('click', () => {
  el('import-text').value = SAMPLE_IMPORT;
  el('import-filename').textContent = '';
  el('import-result').classList.add('hidden');
});
el('import-clear').addEventListener('click', () => {
  el('import-text').value = '';
  el('import-file').value = '';
  el('import-filename').textContent = '';
  el('import-result').classList.add('hidden');
  importState.items = [];
  importState.preview = null;
});
el('import-preview').addEventListener('click', runImportPreview);
// 预演结果整块是动态渲染的，确认与返回用事件委托接住
document.addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  if (node.id === 'import-confirm' && !node.disabled) confirmImport();
  if (node.id === 'import-revise') el('import-text').focus();
});
el('project-form').addEventListener('submit', submitProject);
el('dep-form').addEventListener('submit', submitDep);
el('dep-new').addEventListener('click', () => {
  clearNotice();
  if (!state.projects.length) {
    notify('请先登记一个项目，再登记依赖', 'error');
    return;
  }
  openDepForm(null);
});
el('dep-cancel').addEventListener('click', closeDepForm);
el('filter-apply').addEventListener('click', () => {
  clearNotice();
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-reset').addEventListener('click', () => {
  el('filter-project').value = '';
  el('filter-status').value = '';
  el('filter-license').value = '';
  el('filter-keyword').value = '';
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('dep-refresh').addEventListener('click', () => {
  clearNotice();
  loadProjects()
    .then(loadDeps)
    .catch((err) => notify(err.message, 'error'));
});
el('filter-project').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-status').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-license').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});

// 页面打开时先把项目与依赖登记拉一遍，项目决定登记表单里能选哪些归属
restoreOperator();
loadHealth();
loadProjects()
  .then(loadDeps)
  .catch((err) => notify(err.message, 'error'));
