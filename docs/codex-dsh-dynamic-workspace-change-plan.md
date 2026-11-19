# Codex → DSH 动态工作目录改造方案

## 1. 背景与问题

Codex 已经在 DSH 任务提交参数中传递当前绝对工作目录，但 Windows Agent Bridge 仍然使用 `config.json` 中的固定目录启动 DSH。

2026-11-18 的验证任务要求在：

```text
D:\My-project\flower-studio-ecosystem
```

创建 `dsh-workspace-test.txt`，实际文件却创建在：

```text
C:\Users\Lorem\Documents\Codex\2026-11-13\referenced-chatgpt-conversation-this-is-an
```

已确认当前 Bridge 存在以下行为：

1. `config.json` 使用固定 `workspace`。
2. `POST /jobs` 只读取 `body.task`，不读取每个任务的 `workspace`。
3. Job 状态中不保存 `workspace`。
4. DSH 子进程使用 `cwd: config.workspace`。
5. `DSH_WORKSPACE` 环境变量也固定为 `config.workspace`。

因此，Skill 中的目录要求只能作为提示，无法覆盖 Bridge 设置的进程工作目录。

## 2. 改造目标

每个 DSH Job 必须使用 Codex 本次提交的绝对 `workspace` 作为真实进程工作目录，并满足以下要求：

- 不使用固定目录或临时镜像作为兜底。
- workspace 缺失、非法、不存在或不在允许范围内时立即拒绝任务。
- Job 状态和结果能够显示期望工作目录。
- DSH 启动后可再次核对实际工作目录。
- 不改变现有异步队列、状态同步、超时和取消机制。

## 3. 修改范围

### 3.1 Windows Agent Bridge

修改：

- `agent-bridge/config.json`
- `agent-bridge/server.mjs`
- Bridge 测试脚本

### 3.2 n8n

修改工作流：

- `Codex-DSH-Submit-Job`
- Workflow ID：`SYRBHPvQnOWikXXm`

### 3.3 Codex Skill

补充：

- 提交前目录解析规则；
- DSH 工作目录预检；
- 目录不一致时失败停止；
- 完成后的实际目录报告要求。

## 4. Bridge 配置修改

删除固定工作目录：

```json
"workspace": "C:\\Users\\Lorem\\Documents\\Codex\\2026-11-13\\referenced-chatgpt-conversation-this-is-an"
```

改为允许的工作目录根范围：

```json
"allowedWorkspaceRoots": [
  "D:\\My-project"
]
```

`allowedWorkspaceRoots` 只负责限定可访问范围，不作为任务工作目录的默认值。

## 5. Bridge API 修改

### 5.1 请求契约

`POST /jobs` 请求体由：

```json
{
  "task": "任务内容"
}
```

改为：

```json
{
  "task": "任务内容",
  "workspace": "D:\\My-project\\flower-studio-ecosystem"
}
```

两个字段都必须提供。

### 5.2 读取与规范化

```js
const task =
  typeof body.task === "string"
    ? body.task.trim()
    : "";

const workspaceInput =
  typeof body.workspace === "string"
    ? body.workspace.trim()
    : "";

const workspace = workspaceInput
  ? path.resolve(workspaceInput)
  : "";
```

### 5.3 验证规则

Bridge 必须验证：

1. `task` 非空且未超过长度限制。
2. `workspace` 非空。
3. `workspace` 是绝对路径。
4. 路径实际存在并且是目录。
5. 路径位于至少一个 `allowedWorkspaceRoots` 下。

Windows 路径比较必须忽略大小写，并避免使用简单字符串前缀造成相邻目录误匹配：

```js
const normalizedWorkspace = path.resolve(workspace).toLowerCase();

const allowed = config.allowedWorkspaceRoots.some(root => {
  const normalizedRoot = path.resolve(root).toLowerCase();
  return normalizedWorkspace === normalizedRoot ||
    normalizedWorkspace.startsWith(normalizedRoot + path.sep);
});
```

验证失败时返回 HTTP 400，不创建 Job，不选择其他目录。

## 6. Job 数据结构修改

在 Job 中保存 workspace：

```js
const job = {
  job_id: id,
  status: "queued",
  task,
  workspace,
  created_at: created,
  started_at: null,
  finished_at: null,
  last_activity_at: created,
  current_activity: "queued",
  exit_code: null,
  result: "",
  error: "",
  event_count: 0,
  cancel_requested: false
};
```

`publicJob()` 应返回：

```js
workspace: j.workspace
```

这样 n8n 和 Codex 可以核对 Bridge 实际采用的目录。

## 7. DSH 子进程修改

当前实现：

```js
cwd: config.workspace,
env: {
  ...process.env,
  DSH_WORKSPACE: config.workspace
}
```

改为：

```js
cwd: job.workspace,
env: {
  ...process.env,
  DSH_WORKSPACE: job.workspace
}
```

在 `spawn()` 前再次检查目录仍然存在。如果目录在排队期间被删除或变得不可访问，应将 Job 标记为 `failed`，返回非零退出码，不得退回固定目录。

## 8. n8n 工作流修改

`Codex-DSH-Submit-Job` 向 Bridge 提交的请求体必须包含：

```json
{
  "task": "={{ $json.task }}",
  "workspace": "={{ $json.workspace }}"
}
```

要求：

- 不得只把 workspace 保存到 `dsh_jobs` 数据表。
- 不得只把 workspace 拼入自然语言提示。
- Bridge 响应中的 workspace 应同步保存。
- Bridge 返回 400 时，提交工作流应返回明确错误，不得把任务记录为成功运行。

## 9. Skill 补强

Skill 保留当前“使用 Codex 当前目录”的规则，并增加以下失败停止要求：

```text
Before performing any task operation:

1. Read the actual process working directory.
2. Resolve the actual directory and supplied workspace to absolute paths.
3. Compare them using Windows case-insensitive path comparison.
4. If they are not identical:
   - do not create, modify, move, or delete any file;
   - do not create a mirror, checkout, worktree, or fallback directory;
   - terminate with a non-zero exit code;
   - report expected_workspace and actual_working_directory.
5. Continue only when both paths are identical.
```

Skill 是第二层防护。真实工作目录仍必须由 Bridge 的 `cwd: job.workspace` 保证。

## 10. 测试计划

### 10.1 正常目录

输入：

```text
workspace = D:\My-project\flower-studio-ecosystem
```

预期：

- Job 接受；
- DSH cwd 与输入一致；
- 文件只出现在指定目录；
- Job 查询返回相同 workspace。

### 10.2 不存在的目录

预期：

- Bridge 返回 HTTP 400；
- 不创建 Job；
- 不创建任何目录或文件。

### 10.3 允许范围外目录

例如：

```text
C:\Users\Lorem\Documents
```

预期：Bridge 返回 HTTP 400，不执行 DSH。

### 10.4 缺少 workspace

预期：Bridge 返回 HTTP 400，不使用默认目录。

### 10.5 连续不同目录

连续提交：

```text
Job A → D:\My-project\project-a
Job B → D:\My-project\project-b
```

预期：两个任务分别在各自目录执行，不复用前一个 Job 的 cwd。

### 10.6 排队期间目录失效

在 Job 排队后、启动前使目标目录不可用。

预期：Job 进入 `failed`，不回退到其他目录。

### 10.7 端到端验收

通过 Codex → n8n → Bridge → DSH 提交以下任务：

```text
在当前工作目录创建 dsh-workspace-test.txt，
内容必须且只能为：两个黄鹂鸣翠柳
```

Codex 独立检查：

- 文件位于提交的 workspace；
- 文件内容和编码正确；
- 旧固定目录没有新增同名文件；
- DSH 报告的实际 cwd 与 workspace 一致。

## 11. 部署步骤

1. 停止 Windows Agent Bridge。
2. 备份 `server.mjs` 和 `config.json`。
3. 修改 Bridge 配置、API、Job 数据结构和子进程启动逻辑。
4. 执行 Bridge 单元和接口测试。
5. 重启 Bridge。
6. 检查 `/health`。
7. 修改并发布 n8n 提交工作流。
8. 执行临时目录端到端测试。
9. Codex 独立核对实际文件路径。
10. 验证成功后再恢复正式开发任务分发。

## 12. 回滚方式

如果改造后 Bridge 无法接收任务：

1. 停止 Bridge。
2. 恢复备份的 `server.mjs` 和 `config.json`。
3. 恢复 n8n 工作流上一已发布版本。
4. 重启 Bridge 并验证健康状态。
5. 在动态 workspace 修复完成前暂停 DSH 写操作，不使用固定目录继续正式开发。

回滚仅用于恢复服务可诊断性，不代表可以继续使用错误的固定工作目录执行代码修改。

## 13. 验收标准

只有同时满足以下条件才算改造完成：

- Bridge 接收并保存每个 Job 的 workspace。
- DSH 子进程 cwd 等于该 Job 的 workspace。
- 缺失、非法、不存在或越界 workspace 均被拒绝。
- 不存在固定工作目录兜底。
- n8n 完整透传 workspace。
- DSH 目录预检不一致时返回失败。
- 连续不同目录任务互不串目录。
- Codex 端到端测试确认文件只出现在目标目录。

