# 评测环境修复计划

## 🎯 目标
确保任务失败是因为AI逻辑错误，而不是因为评测环境无法适配AI的代码结构。

## 📋 当前问题分析

### 问题1: 变量作用域问题（100%失败任务的共同问题）

**现象**：
- AI将结果保存为文件（pickle/CSV/JSON/TXT）
- 测试用例期望变量在命名空间中直接可用
- 导致`NameError: name 'xxx' is not defined`

**根本原因**：
当前评测器的`load_submission_outputs()`方法虽然加载了文件，但：
1. 加载的变量名是基于文件名（如`results.pkl` → `results`变量）
2. 测试用例期望的变量名可能不同（如期望`output_df`但文件名是`result.pkl`）
3. AI使用函数封装和`if __name__ == '__main__'`，导致变量未在全局作用域定义

### 问题2: 文件名与变量名不匹配

**案例**：
- 测试期望：`output_df`
- AI保存：`result.pkl` 或 `output.pkl`
- 评测器加载：`result` 或 `output`（基于文件名）
- 结果：变量名不匹配

### 问题3: AI代码未被执行

**现象**：
- AI生成`solver.py`或`solution.py`
- 评测器只加载输出文件，不执行AI的Python代码
- 如果AI没有保存文件，或者代码中有副作用（如定义全局变量），这些都会丢失

## 🔧 修复方案

### 方案1: 执行AI的Python代码（推荐）

**优点**：
- 完全模拟reference answer的执行方式
- AI的代码结构（函数、类、全局变量）都能正常工作
- 不依赖文件名匹配

**实现**：
1. 在`load_submission_outputs()`之前，先尝试执行AI的Python文件
2. 执行时使用与test_cases相同的命名空间
3. 如果执行失败，再回退到加载文件的方式

### 方案2: 智能变量名映射（辅助）

**优点**：
- 解决文件名与变量名不匹配的问题
- 保持向后兼容

**实现**：
1. 从test_cases.py中提取期望的变量名
2. 如果namespace中没有这些变量，尝试从文件中加载
3. 使用智能匹配（如`output.pkl` → `output_df`）

### 方案3: 增强错误信息

**优点**：
- 帮助调试
- 明确失败原因

**实现**：
1. 区分"变量未定义"和"断言失败"
2. 提供详细的差异信息（期望值 vs 实际值）
3. 列出namespace中所有可用的变量

## 📝 具体修复步骤

### Step 1: 执行AI的Python代码

在`evaluate()`方法中，在加载输出文件之前，先执行AI的代码：

```python
def execute_ai_code(self, namespace: Dict[str, Any]) -> bool:
    """
    执行AI生成的Python代码
    返回True表示成功执行，False表示需要回退到文件加载
    """
    # 查找AI生成的Python文件
    python_files = ['solver.py', 'solution.py', 'answer.py', 'main.py']
    
    for filename in python_files:
        code_path = self.outputs_dir / filename
        if code_path.exists():
            try:
                print(f"  - 执行 {filename}")
                code = code_path.read_text(encoding="utf-8")
                
                # 在相同的命名空间中执行
                exec(compile(code, str(code_path), "exec"), namespace)
                
                print(f"  ✓ {filename} 执行成功")
                return True
            except Exception as e:
                print(f"  ⚠️  {filename} 执行失败: {e}")
                # 继续尝试下一个文件
                continue
    
    return False
```

### Step 2: 增强智能变量名映射

改进`smart_alias_variables()`方法：

```python
def smart_alias_variables(self, namespace: Dict[str, Any], submission_vars: Dict[str, Any] = None):
    """
    智能变量名映射：
    1. 从test_cases.py提取期望的变量名
    2. 如果namespace中没有，尝试从submission_vars中匹配
    3. 支持模糊匹配（如 output.pkl → output_df）
    """
    # ... 现有逻辑 ...
    
    # 新增：模糊匹配逻辑
    for missing in missing_vars:
        # 尝试精确匹配
        if missing in candidate_objects:
            namespace[missing] = candidate_objects[missing]
            print(f"  ✓ 精确匹配: {missing}")
            continue
        
        # 尝试模糊匹配（去掉下划线、后缀等）
        missing_normalized = missing.lower().replace('_', '')
        for src_name, src_val in candidate_objects.items():
            src_normalized = src_name.lower().replace('_', '')
            if missing_normalized == src_normalized or \
               missing_normalized in src_normalized or \
               src_normalized in missing_normalized:
                namespace[missing] = src_val
                print(f"  ✓ 模糊匹配: {src_name} → {missing}")
                break
```

### Step 3: 增强错误信息

改进`run_test_cases()`方法：

```python
def run_test_cases(self, namespace: Dict[str, Any]) -> Dict[str, Any]:
    """执行test_cases.py"""
    try:
        # ... 执行测试 ...
        
    except NameError as e:
        # 提取缺失的变量名
        import re
        match = re.search(r"name '(\w+)' is not defined", str(e))
        missing_var = match.group(1) if match else "unknown"
        
        # 列出可用的变量
        available_vars = [k for k in namespace.keys() 
                         if not k.startswith('_') and k not in {'pd', 'np', 'os', 'sys'}]
        
        return {
            "status": "error",
            "reward": 0,
            "feedback": f"变量未定义: '{missing_var}'\n"
                       f"可用变量: {available_vars}\n"
                       f"提示: 请确保在全局作用域定义变量，或保存为与变量名匹配的文件"
        }
    
    except AssertionError as e:
        # 尝试提取断言的详细信息
        import traceback
        tb = traceback.format_exc()
        
        return {
            "status": "fail",
            "reward": 0,
            "feedback": f"断言失败:\n{tb}\n"
                       f"提示: 检查输出值是否与期望值匹配"
        }
```

## 🧪 测试计划

### 测试用例1: 函数封装的代码
```python
# AI生成的代码
def solve():
    result = pd.DataFrame(...)
    return result

if __name__ == '__main__':
    output_df = solve()
```

**期望**：评测器执行代码后，`output_df`在namespace中可用

### 测试用例2: 文件名不匹配
```python
# AI保存为 result.pkl
# 测试期望 output_df
```

**期望**：智能映射将`result` → `output_df`

### 测试用例3: 只有文件，没有代码
```python
# AI只生成了 output_df.pkl，没有.py文件
```

**期望**：评测器从文件加载变量

## 📊 预期效果

修复后，11个失败任务的状态：

| 任务 | 当前失败原因 | 修复后预期 |
|------|-------------|-----------|
| 29713087_2 | 变量未定义 + 逻辑错误 | 仅逻辑错误（阈值错误） |
| 25303977_5 | 变量未定义 + 逻辑错误 | 仅逻辑错误（分组错误） |
| 32864625_2 | 变量未定义 + 逻辑错误 | 仅逻辑错误（数据范围） |
| 34819518_3 | 变量未定义 + 逻辑错误 | 仅逻辑错误（患者数量） |
| 28481359_2 | 变量未定义 + 列名错误 | 仅列名错误 |
| 28985567_8 | 变量未定义 + 逻辑错误 | 仅逻辑错误（上下文依赖） |
| 27959731_1 | 变量未定义 + 逻辑错误 | 仅逻辑错误（数据范围） |
| 28472509_4 | 变量未定义 + 列名错误 | 仅列名错误 |
| 37699004_2 | 变量未定义 + 百分比错误 | 仅百分比错误 |
| 33765338_3 | 变量未定义 + 定义过宽 | 仅定义过宽 |
| 32437664_10 | 变量未定义 + 数据源错误 | 仅数据源错误 |

**预期通过率提升**：
- 如果只有列名/百分比等细节错误的任务，修复后可能通过
- 28481359_2（列名错误）：可能通过（如果智能映射能处理）
- 其他任务：仍会失败，但错误信息更明确

## ✅ 下一步

1. 实现修复代码
2. 在一个失败任务上测试
3. 验证错误信息是否更清晰
4. 全量测试所有失败任务
