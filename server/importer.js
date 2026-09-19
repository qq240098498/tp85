// 清单导入：把文件或粘贴来的内容解析成一条条登记，先预演（哪些能导、哪些与已有登记
// 同项目同名、哪些不成立），确认后再把通过的条目一次性落盘
const crypto = require('crypto');
const { load, save } = require('./store');
const { ApiError, pickText } = require('./errors');
const {
  validateName,
  validateVersion,
  validateLicense,
  validateOwner,
  validateStatus,
  validateNote,
} = require('./deps');

const MAX_IMPORT_ENTRIES = 500;

// 清单里每一列可能用的写法，统一归到内部字段上；匹配前表头会去掉首尾空白并转小写
const FIELD_ALIASES = {
  project: ['project', 'projectname', '项目', '项目名称', '所属项目'],
  name: ['name', 'dep', 'depname', '依赖', '依赖名称'],
  version: ['version', '版本'],
  license: ['license', '许可'],
  owner: ['owner', '责任人'],
  status: ['status', '状态'],
  note: ['note', '备注'],
};

const FIELD_ALIAS_MAP = {};
Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
  aliases.forEach((alias) => {
    FIELD_ALIAS_MAP[alias] = field;
  });
});

function normalizeKey(key) {
  return String(key || '').trim().toLowerCase();
}

// 把一条原始记录整理成固定字段，值一律转成去掉首尾空白的文本
function pickEntry(raw) {
  const entry = { project: '', name: '', version: '', license: '', owner: '', status: '', note: '' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return entry;
  Object.keys(raw).forEach((key) => {
    const field = FIELD_ALIAS_MAP[normalizeKey(key)];
    if (!field) return;
    const value = raw[key];
    entry[field] = value === null || value === undefined ? '' : String(value).trim();
  });
  return entry;
}

// 按 CSV 规则切文本：引号包裹的字段里可以有分隔符与换行，两个双引号表示一个引号；
// 第一行里有制表符且没有逗号时按制表符分隔（从表格软件直接复制出来就是这种）
function splitCsvRows(text) {
  const firstLine = text.split('\n', 1)[0];
  const delimiter = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; continue; }
    if (ch === delimiter) { endField(); continue; }
    if (ch === '\r') { continue; }
    if (ch === '\n') { endRow(); continue; }
    field += ch;
  }
  if (field !== '' || row.length) endRow();
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

// CSV 第一行必须是表头，至少能认出「项目」与「依赖名称」两列，认不出的列直接忽略
function parseCsvEntries(text) {
  const rows = splitCsvRows(text);
  if (rows.length < 2) {
    throw new ApiError(400, 'IMPORT_EMPTY', '清单里没有可导入的条目', '');
  }
  const columns = rows[0].map((cell) => FIELD_ALIAS_MAP[normalizeKey(cell)] || '');
  if (!columns.includes('project') || !columns.includes('name')) {
    throw new ApiError(400, 'IMPORT_HEADER_MISSING', '清单第一行需要是表头，至少能认出「项目」与「依赖名称」两列', '');
  }
  return rows.slice(1).map((cells) => {
    const raw = {};
    columns.forEach((field, index) => {
      if (field) raw[field] = cells[index] === undefined ? '' : cells[index];
    });
    return raw;
  });
}

function parseJsonEntries(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ApiError(400, 'IMPORT_JSON_INVALID', '清单内容不是合法的 JSON，请检查括号、引号是否配对', '');
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const bad = list.some((item) => !item || typeof item !== 'object' || Array.isArray(item));
  if (bad) {
    throw new ApiError(400, 'IMPORT_ENTRY_INVALID', '清单里的每一条都要是对象，至少带上项目与依赖名称', '');
  }
  return list;
}

// 按内容样子分格式：以 [ 或 { 开头按 JSON 解析，否则按带表头的 CSV 解析
function parseImportText(text) {
  const content = pickText(text);
  if (!content) throw new ApiError(400, 'IMPORT_EMPTY', '请先选择文件或粘贴清单内容', '');
  const rawList = content.startsWith('[') || content.startsWith('{')
    ? parseJsonEntries(content)
    : parseCsvEntries(content);
  const entries = rawList.map(pickEntry);
  if (!entries.length) throw new ApiError(400, 'IMPORT_EMPTY', '清单里没有可导入的条目', '');
  if (entries.length > MAX_IMPORT_ENTRIES) {
    throw new ApiError(400, 'IMPORT_TOO_MANY', `一次最多导入 ${MAX_IMPORT_ENTRIES} 条，这份清单有 ${entries.length} 条，请拆分后再导`, '');
  }
  return entries;
}

// 每个字段的校验都走一遍，错误全部收集起来，而不是遇到第一个就停；
// 校验规则与单条登记用的是同一套函数，口径完全一致
function checkFields(entry) {
  const errors = [];
  const checked = {};
  const run = (field, validate) => {
    try {
      checked[field] = validate(entry[field]);
    } catch (err) {
      checked[field] = '';
      errors.push({ field, code: err.code || '', message: err.message });
    }
  };
  run('name', validateName);
  run('version', validateVersion);
  run('license', validateLicense);
  run('owner', validateOwner);
  run('status', validateStatus);
  run('note', validateNote);
  return { checked, errors };
}

// 预演与正式导入共用的分析：逐条校验、对照已有登记查同项目同名、查本次导入内部重复
function analyze(text) {
  const data = load();
  const entries = parseImportText(text);
  const projectsByName = new Map(data.projects.map((item) => [item.name.toLowerCase(), item]));
  const existingByKey = new Map();
  data.deps.forEach((item) => {
    const key = `${item.projectId}::${item.name.toLowerCase()}`;
    if (!existingByKey.has(key)) existingByKey.set(key, item);
  });

  const ready = [];
  const conflicts = [];
  const invalid = [];
  const seenInBatch = new Map();

  entries.forEach((entry, offset) => {
    const index = offset + 1;
    const errors = [];

    let project = null;
    if (!entry.project) {
      errors.push({ field: 'project', code: 'PROJECT_REQUIRED', message: '请填写项目名称' });
    } else {
      project = projectsByName.get(entry.project.toLowerCase()) || null;
      if (!project) {
        errors.push({ field: 'project', code: 'PROJECT_NOT_FOUND', message: `项目「${entry.project}」没有登记过，请先在项目区登记` });
      }
    }

    const { checked, errors: fieldErrors } = checkFields(entry);
    errors.push(...fieldErrors);

    // 项目与名称都站得住，才谈得上与已有登记或本次导入里的其他条目重复
    const key = project && checked.name ? `${project.id}::${checked.name.toLowerCase()}` : '';
    if (key && seenInBatch.has(key)) {
      errors.push({
        field: 'name',
        code: 'IMPORT_DUPLICATED',
        message: `与本次导入的第 ${seenInBatch.get(key)} 条同为「${project.name} / ${checked.name}」`,
      });
    }

    if (errors.length) {
      invalid.push({ index, entry, errors });
      return;
    }
    seenInBatch.set(key, index);

    const item = {
      index,
      projectId: project.id,
      project: project.name,
      name: checked.name,
      version: checked.version,
      license: checked.license,
      owner: checked.owner,
      status: checked.status,
      note: checked.note,
    };

    const existing = existingByKey.get(key);
    if (existing) {
      conflicts.push({
        ...item,
        existing: { version: existing.version, status: existing.status, owner: existing.owner },
      });
      return;
    }
    ready.push(item);
  });

  return { data, total: entries.length, ready, conflicts, invalid };
}

// 预演：只分析不落盘，返回总数、可导入、同项目同名与不成立四份结果
function previewImport(text) {
  const { total, ready, conflicts, invalid } = analyze(text);
  return { total, ready, conflicts, invalid };
}

// 正式导入：重新分析一遍，只把预演通过的条目写进数据文件，重复与不成立的一律跳过
function runImport(text) {
  const result = analyze(text);
  const now = new Date().toISOString();
  const created = result.ready.map((item) => ({
    id: crypto.randomUUID(),
    projectId: item.projectId,
    name: item.name,
    version: item.version,
    license: item.license,
    owner: item.owner,
    status: item.status,
    note: item.note,
    createdAt: now,
    updatedAt: now,
  }));
  if (created.length) {
    result.data.deps.push(...created);
    save(result.data);
  }
  return {
    total: result.total,
    imported: created.length,
    skipped: result.conflicts.length,
    failed: result.invalid.length,
  };
}

module.exports = { previewImport, runImport };
