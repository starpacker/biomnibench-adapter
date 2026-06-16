# 路径问题修复方案

## 问题分析

### 当前状态
- **AI工作目录**: `runDir` (run root)
- **系统提示**: 明确告诉AI `cwd: run root`
- **数据路径**: `public/workdir/` (从run root)
- **AI代码位置**: `workspace/` (从run root)

### 问题根源
AI在探索阶段可能：
1. 在workspace/目录中创建探索脚本（如`explore_data.py`）
2. 在workspace/目录中运行脚本：`cd workspace && python explore_data.py`
3. 此时相对路径变为`../public/workdir/`（从workspace看）
4. AI学到这个路径，在最终solver.py中也使用`../public/workdir/`
5. 评测器从run root执行solver.py，`../public/workdir/`路径错误

### 验证
- 28481359_5子任务：AI使用`../public/workdir/`导致失败
- 28481359_2,3,4子任务：AI使用`public/workdir/`成功

## 解决方案

### 方案1：修改系统提示（推荐）✅

在系统提示中明确告诉AI：
- 始终使用从run root的相对路径
- 数据文件路径：`public/workdir/xxx.csv`
- 不要使用`../public/workdir/`

**优点**：
- 从源头解决问题
- AI学到正确的路径模式
- 不需要修改评测器

**实施**：
修改`src/harness/evaluation/sourceContextBuilder.ts`，在`<workflow>`部分添加：

```typescript
'<workflow>',
'1. Use <output_contract> and <visible_cases> as the submission contract...',
'2. Once you understand the task, write...',
'3. Write solver code under workspace/ and longer experiments under workspace/experiments/.',
'4. IMPORTANT: Always use paths relative to run root (cwd). Data files are at public/workdir/, NOT ../public/workdir/.',
'5. Use Bash for short commands or to run scripts...',
```

### 方案2：评测器路径修正

在评测器执行AI代码前，自动修正路径：
- 检测`../public/workdir/`
- 替换为`public/workdir/`

**优点**：
- 兼容AI的错误路径
- 不需要修改系统提示

**缺点**：
- 治标不治本
- AI继续学习错误的路径模式

### 方案3：统一使用绝对路径

在系统提示中提供环境变量：
- `WORKDIR=/path/to/run/public/workdir`
- AI使用`os.environ['WORKDIR']`

**优点**：
- 完全避免相对路径问题

**缺点**：
- 需要修改系统提示和评测器
- AI代码更复杂

## 推荐实施

**立即实施**：方案1（修改系统提示）

**步骤**：
1. 修改`src/harness/evaluation/sourceContextBuilder.ts`
2. 在`<workflow>`部分添加路径使用说明
3. 重新测试28481359_5子任务
4. 验证AI使用正确的路径

**预期效果**：
- AI在探索和求解阶段都使用`public/workdir/`
- 评测器执行时路径正确
- 子任务5通过
