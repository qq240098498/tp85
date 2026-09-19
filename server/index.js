const path = require('path');
const express = require('express');
const api = require('./api');

const app = express();
const PORT = process.env.PORT || 5085;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// 健康检查：页面右上角据此显示服务连接状态
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, port: PORT });
});

app.get('/api/projects', (_req, res) => {
  res.json({ projects: api.listProjects() });
});

app.post('/api/projects', (req, res) => {
  try {
    res.status(201).json(api.createProject(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/projects/:id', (req, res) => {
  try {
    res.json(api.updateProject(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/projects/:id', (req, res) => {
  try {
    res.json(api.deleteProject(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// 依赖清单：按项目、状态、许可筛选，再按依赖名或责任人搜索
app.get('/api/deps', (req, res) => {
  const result = api.listDeps({
    projectId: api.readQuery(req.query, 'projectId'),
    status: api.readQuery(req.query, 'status'),
    license: api.readQuery(req.query, 'license'),
    keyword: api.readQuery(req.query, 'keyword'),
  });
  res.json(result);
});

app.post('/api/deps', (req, res) => {
  try {
    res.status(201).json(api.createDep(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

// 批量导入先预演：不落盘，只返回每条条目能不能导、问题出在哪
app.post('/api/deps/import-preview', (req, res) => {
  try {
    res.json(api.previewImport(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

// 确认导入：服务端按最新数据重新校验一遍，只写入仍成立且不与已有登记撞名的条目
app.post('/api/deps/import', (req, res) => {
  try {
    res.status(201).json(api.commitImport(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/deps/:id', (req, res) => {
  try {
    res.json(api.getDep(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/deps/:id', (req, res) => {
  try {
    res.json(api.updateDep(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/deps/:id', (req, res) => {
  try {
    res.json(api.deleteDep(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// 未匹配到的接口路径统一返回说明，避免前端拿到一串页面内容
app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'API_NOT_FOUND', message: '接口不存在', field: '' } });
});

// 统一错误出口：业务异常按状态码与错误码返回，其余按服务异常处理
function sendError(res, err) {
  if (err instanceof api.ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, field: err.field },
    });
  }
  console.error('[tp85] 处理请求时出现未预期的问题：', err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: '服务内部异常，请稍后重试', field: '' },
  });
}

// 请求体解析失败时给出明确说明
app.use((err, _req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'BODY_INVALID_JSON', message: '提交的内容不是合法的 JSON', field: '' },
    });
  }
  if (err) return sendError(res, err);
  return next();
});

app.listen(PORT, () => {
  console.log(`依赖台账与版本核查平台已启动：http://localhost:${PORT}`);
});
