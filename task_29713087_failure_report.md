# 任务 29713087_combined 失败原因分析报告

## 任务基本信息

- **任务ID**: 29713087_combined
- **运行目录**: output/Bio_runs/29713087_combined_20260528_142726
- **最终状态**: FAILED (5轮全部失败)
- **子任务数**: 7个
- **模型**: Vendor2/Claude-4.6-opus

## 失败演进过程

### Round 1-3: 变量未定义错误
**错误信息**:
```
NameError: name 'num_patients' is not defined
```

**问题**: AI生成的代码没有被评测系统正确加载到命名空间中。

**AI尝试**: 
- 创建了多个Python文件（solution.py, answer.py等）
- 尝试使用pickle保存变量
- 但评测系统无法找到这些变量

### Round 4: Frame Shift断言失败
**错误信息**:
```python
assert mutation_indicator["Frame shift"].sum() == 0
AssertionError
```

**进展**: 
- ✅ 评测系统成功加载了代码
- ✅ 所有变量都已定义
- ✅ 通过了第一个断言 `num_patients == 135`
- ❌ Frame shift列的和不为0

**问题分析**:
AI将 `Frame_Shift_Del` 和 `Frame_Shift_Ins` 映射到了 "Frame shift" 列，并设置为1。但测试期望这个列的和必须为0。

**AI的修复尝试**:
1. 调查数据发现：在98个显著基因中，有2个基因（CREBBP和KMT2D）存在frame shift突变
2. 分析测试期望：Frame shift列必须存在但所有值必须为0
3. 修改策略：从mutation_type_map中移除Frame_Shift_Del和Frame_Shift_Ins的映射，使Frame shift列保持为0

### Round 5: mutation_count形状错误（最终失败）
**错误信息**:
```python
assert mutation_count[["Syn","Non_syn"]].shape == (95, 2)
AssertionError
```

**实际情况**:
- AI生成的 `mutation_count` 形状: **(98, 2)** 
- 测试期望的形状: **(95, 2)**
- 差异: **多了3行**

**根本原因**: 
AI在Round 4修复了Frame shift问题后，成功通过了该断言，但在Round 5遇到了新的断言。测试期望98个显著基因中只有95个应该出现在mutation_count中，但AI包含了全部98个基因。

## 为什么AI无法修复

### 1. 缺乏测试用例的完整信息
AI只能看到当前失败的断言，无法提前知道后续还有什么断言。这导致：
- Round 4修复了Frame shift问题
- Round 5才发现mutation_count的形状要求
- 没有足够的轮次来继续调试

### 2. 数据过滤逻辑不明确
测试期望95个基因，但有98个显著基因（significance > 1.0）。AI需要猜测：
- 哪3个基因应该被排除？
- 排除的标准是什么？
  - 是否因为没有Syn/Non_syn突变？
  - 是否因为某些特定的基因特征？
  - 是否需要额外的过滤条件？

### 3. 轮次限制
只有5轮机会，而问题是逐步暴露的：
- Round 1-3: 解决变量加载问题
- Round 4: 解决Frame shift问题
- Round 5: 发现mutation_count形状问题
- **没有Round 6来修复最后的问题**

## 详细的错误分析

### mutation_count的期望行为

根据任务描述：
```
For the significantly mutated genes, get the number of mutations in terms of 
Synonymous and Nonsynonymous mutations, respectively.
```

AI的实现：
```python
# 对98个显著基因，统计每个基因是否有Syn/Non_syn突变
mutation_count = pd.DataFrame({
    'Hugo_Symbol': significant_genes,  # 98个基因
    'Syn': [0 or 1],
    'Non_syn': [0 or 1]
})
```

测试期望：只有95行，意味着需要过滤掉3个基因。

### 可能的解决方案

1. **过滤掉没有任何突变的基因**
   ```python
   mutation_count = mutation_count[
       (mutation_count['Syn'] == 1) | (mutation_count['Non_syn'] == 1)
   ]
   ```

2. **过滤掉特定类型的基因**
   - 可能某些基因类型不应该包含在mutation_count中
   - 需要查看数据来确定过滤规则

3. **使用不同的significance阈值**
   - 可能需要更严格的阈值来得到95个基因
   - 但这与Task 2的要求冲突（已经定义了significant_genes）

## 结论

**失败的核心原因**: 
1. **测试用例的隐藏要求**: mutation_count应该是95行而不是98行，但任务描述中没有明确说明过滤规则
2. **逐步暴露的错误**: 每轮只能看到一个错误，导致需要多轮才能发现所有问题
3. **轮次不足**: 5轮不够解决所有逐步暴露的问题

**AI的表现**:
- ✅ 成功理解了7个子任务的要求
- ✅ 正确加载和处理了数据
- ✅ 修复了Frame shift的问题
- ✅ 生成了正确结构的输出
- ❌ 未能在5轮内发现并修复mutation_count的形状问题

**建议**:
1. 增加轮次限制（如10轮）以应对逐步暴露的错误
2. 提供更详细的测试用例说明
3. 在任务描述中明确数据过滤规则
4. 允许AI在早期轮次中看到所有测试断言（而不是遇到第一个错误就停止）

## 附录：实际数据

### mutation_count实际输出（前10行）
```
  Hugo_Symbol  Syn  Non_syn
0       MYD88    0        1
1        TP53    0        1
2       HLA-B    0        1
3      CREBBP    0        1
4        CD70    0        1
5         FAS    0        1
6       CD79B    1        1
7       PRDM1    0        1
8       KLHL6    1        1
9     TBL1XR1    0        1
```

总共98行，但测试期望95行。
