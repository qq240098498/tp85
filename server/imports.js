// 批量导入：一次拿到别人整理好的多条依赖登记，先在页面上预演，再确认落盘。
// 校验口径与单条登记完全一致，这里不再另写一套规则，只把同一批里才有的问题
// （项目没登记过、批内重复、与已有登记撞名）汇总成逐条结论返回给页面。
const crypto = require('crypto');
const {
  load,
  save,
  STATUSES,
  MAX_NAME_LENGTH,
  MAX_VERSION_LENGTH,
  MAX_LICENSE_LENGTH,
  MAX_OWNER_LENGTH,
  MAX_NOTE_LENGTH,
} = require('./store');
const { ApiError, pickText } = require('./errors');
const {
  validateName,
  validateVersion,
  validateLicense,
  validateOwner,
  validateStatus,
  validateNote,
} = require('./deps');

const MAX_IMPORT_ROWS = 500;

// 导入字段：页面与接口之间统一用这一组键，项目按名称匹配，不靠 id
const FIELD_KEYS = {
  project: ['project', 'projectname', '项目', '项目名称', '所属项目'],
  name: ['name', 'depname', '依赖', '依赖名称', '依赖名'],
  version: ['version', '版本'],
  license: ['license', 'licence', '许可'],
  owner: ['owner', '责任人'],
  status: ['status', '状态'],
  note: ['note', 'remark', '备注'],
};

function normalizeKey(value) {
  return pickText(value).toLowerCase().replace(/[\s_\-]/g, '');
}

// 把对象形式的一行按表头别名归到固定字段上，未知表头直接忽略
function mapRecord(record) {
  const source = record && typeof record === 'object' ? record : {};
  const row = { project: '', name: '', version: '', license: '', owner: '', status: '', note: '' };
  Object.keys(source).forEach((key) => {
    const compact = normalizeKey(key);
    Object.keys(FIELD_KEYS).some((field) => {
      if (FIELD_KEYS[field].map(normalizeKey).includes(compact)) {
        const value = source[key];
        row[field] = typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value));
        return true;
      }
      return false;
    });
  });
  return row;
}

function toRows(items) {
  if (!Array.isArray(items)) {
    throw new ApiError(400, 'IMPORT_ROWS_INVALID', '导入内容需要是一组条目，每一条包含项目、依赖名称与版本', '');
  }
  if (!items.length) throw new ApiError(400, 'IMPORT_EMPTY', '没有读到任何可导入的条目', '');
  if (items.length > MAX_IMPORT_ROWS) {
    throw new ApiError(400, 'IMPORT_TOO_MANY', `一次最多导入 ${MAX_IMPORT_ROWS} 条，请拆开再导`, '');
  }
  return items.map(mapRecord);
}

// 跑一遍单条字段的校验，成立就返回规整后的值，不成立就把错误码与说明带回去，
// 不在这里抛异常：批量场景要把所有问题一次列全
function checkField(field, value, validator) {
  try {
    return { ok: true, value: validator(value) };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message, field };
  }
}

// 预演：只读数据，不落盘。逐条给出结论，能导入多少、哪些和已有登记撞名、哪些本身不成立
function analyzeImport(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const rows = toRows(input.items);
  const data = load();

  // 项目按名称匹配，比较时忽略大小写，和项目重名校验的口径一致
  const projectByName = new Map();
  data.projects.forEach((project) => projectByName.set(project.name.toLowerCase(), project));

  // 已有登记按「项目 + 依赖名（忽略大小写）」建好索引
  const existingByKey = new Map();
  data.deps.forEach((dep) => {
    existingByKey.set(`${dep.projectId}__${dep.name.toLowerCase()}`, dep);
  });

  // 批内同项目同名只在同组的第一条标重复，后面的条目都指向它
  const batchSeen = new Map();

  const results = rows.map((row, index) => {
    const line = index + 1;
    const problems = [];

    const projectNameText = pickText(row.project);
    if (!projectNameText) {
      problems.push({ code: 'PROJECT_REQUIRED', field: 'project', message: '没有填项目名称' });
    }
    const project = projectNameText ? projectByName.get(projectNameText.toLowerCase()) : null;
    if (projectNameText && !project) {
      problems.push({ code: 'PROJECT_NOT_FOUND', field: 'project', message: `项目 ${projectNameText} 没有登记过，请先在项目区登记` });
    }

    const nameResult = checkField('name', row.name, validateName);
    if (!nameResult.ok) problems.push({ code: nameResult.code, field: 'name', message: nameResult.message });

    const versionResult = checkField('version', row.version, validateVersion);
    if (!versionResult.ok) problems.push({ code: versionResult.code, field: 'version', message: versionResult.message });

    // 状态留空时按单条登记的口径默认成第一个合法值，不算问题
    const statusText = pickText(row.status);
    let statusValue = STATUSES[0];
    if (!statusText) {
      statusValue = STATUSES[0];
    } else if (!STATUSES.includes(statusText)) {
      problems.push({ code: 'STATUS_INVALID', field: 'status', message: `状态 ${statusText} 不认识，只能填 ${STATUSES.join('、')}` });
    } else {
      statusValue = statusText;
    }

    // 许可、责任人、备注不影响条目成立与否，超长时仍然按单条口径指出
    const licenseResult = checkField('license', row.license, validateLicense);
    if (!licenseResult.ok) problems.push({ code: licenseResult.code, field: 'license', message: licenseResult.message });
    const ownerResult = checkField('owner', row.owner, validateOwner);
    if (!ownerResult.ok) problems.push({ code: ownerResult.code, field: 'owner', message: ownerResult.message });
    const noteResult = checkField('note', row.note, validateNote);
    if (!noteResult.ok) problems.push({ code: noteResult.code, field: 'note', message: noteResult.message });

    // 同一次导入里出现两条同项目同名：后出现的条目算重复
    let duplicateOf = 0;
    if (project && nameResult.ok) {
      const key = `${project.id}__${nameResult.value.toLowerCase()}`;
      if (batchSeen.has(key)) {
        duplicateOf = batchSeen.get(key);
        problems.push({ code: 'IMPORT_DUPLICATED_IN_BATCH', field: 'name', message: `同一次导入里第 ${duplicateOf} 条已经是 ${project.name} 的 ${nameResult.value}，这一条重复了` });
      } else {
        batchSeen.set(key, line);
      }
    }

    // 与已有登记同项目同名：单独标出来，页面上让人决定要不要跳过
    let existing = null;
    if (project && nameResult.ok && !duplicateOf) {
      const hit = existingByKey.get(`${project.id}__${nameResult.value.toLowerCase()}`);
      if (hit) {
        existing = { id: hit.id, version: hit.version, status: hit.status };
        problems.push({ code: 'IMPORT_ALREADY_EXISTS', field: 'name', message: `${project.name} 下已经登记过 ${hit.name}（当前版本 ${hit.version}），导入会跳过这一条` });
      }
    }

    // 预演时就把规整后的值带上，确认阶段直接采用，避免二次解析出现偏差
    const normalized = {
      projectName: project ? project.name : projectNameText,
      projectId: project ? project.id : '',
      name: nameResult.ok ? nameResult.value : pickText(row.name),
      version: versionResult.ok ? versionResult.value : pickText(row.version),
      license: licenseResult.ok ? licenseResult.value : pickText(row.license),
      owner: ownerResult.ok ? ownerResult.value : pickText(row.owner),
      status: statusValue,
      note: noteResult.ok ? noteResult.value : pickText(row.note),
    };

    const blocking = problems.some((item) => item.code !== 'IMPORT_ALREADY_EXISTS');
    return {
      line,
      normalized,
      problems,
      duplicated: duplicateOf > 0,
      duplicateOf,
      exists: Boolean(existing),
      existing: existing || undefined,
      // 与已有登记撞名不算「不成立」，确认时会自动跳过；其余任何问题都不导入
      valid: !blocking,
      importable: !blocking && !existing,
    };
  });

  const total = results.length;
  const importable = results.filter((item) => item.importable).length;
  // 只统计本身成立、仅仅因为与已有登记撞名而跳过的条目；不成立的条目归入 invalid
  const existing = results.filter((item) => item.valid && item.exists).length;
  const invalid = results.filter((item) => !item.valid).length;

  return {
    total,
    importable,
    existing,
    invalid,
    statuses: STATUSES.slice(),
    results,
  };
}

// 确认导入：重新基于最新数据预演一遍（防止打开预演后数据被别人改过），
// 只落盘仍可导入的条目；与已有登记撞名或批内重复的一律跳过
function commitImport(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();

  // 确认阶段不相信前端回传的结论，只信条目内容，重新跑一遍
  const preview = analyzeImport({ items: toRows(input.items) });

  const projectById = new Map(data.projects.map((project) => [project.id, project]));
  const now = new Date().toISOString();
  const created = [];
  const skipped = [];

  // 落盘过程中也要记住本批已经写入的键，防止同键条目漏网
  const claimed = new Set(data.deps.map((dep) => `${dep.projectId}__${dep.name.toLowerCase()}`));

  preview.results.forEach((item) => {
    if (!item.valid || item.exists) {
      skipped.push({ line: item.line, reason: item.problems[0] ? item.problems[0].code : 'IMPORT_ALREADY_EXISTS' });
      return;
    }
    const key = `${item.normalized.projectId}__${item.normalized.name.toLowerCase()}`;
    if (claimed.has(key)) {
      skipped.push({ line: item.line, reason: 'IMPORT_ALREADY_EXISTS' });
      return;
    }
    const project = projectById.get(item.normalized.projectId);
    if (!project) {
      skipped.push({ line: item.line, reason: 'PROJECT_NOT_FOUND' });
      return;
    }
    const record = {
      id: crypto.randomUUID(),
      projectId: project.id,
      name: item.normalized.name,
      version: item.normalized.version,
      license: item.normalized.license,
      owner: item.normalized.owner,
      status: item.normalized.status,
      note: item.normalized.note,
      createdAt: now,
      updatedAt: now,
    };
    data.deps.push(record);
    claimed.add(key);
    created.push({ line: item.line, id: record.id, projectName: project.name, name: record.name, version: record.version });
  });

  if (created.length) save(data);

  return {
    total: preview.total,
    imported: created.length,
    skipped: skipped.length,
    created,
    skippedDetail: skipped,
  };
}

module.exports = {
  analyzeImport,
  previewImport: analyzeImport,
  commitImport,
  FIELD_KEYS,
  MAX_IMPORT_ROWS,
  MAX_NAME_LENGTH,
  MAX_VERSION_LENGTH,
  MAX_LICENSE_LENGTH,
  MAX_OWNER_LENGTH,
  MAX_NOTE_LENGTH,
};
