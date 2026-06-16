# BioMniBench 测试完整流程总结

## ✅ 第一阶段：任务执行 - **已完成**

### 测试结果
- **任务**: da-1-3
- **状态**: ✅ 成功完成
- **用时**: 15.3 分钟 (917 秒)
- **迭代**: 29 次
- **Token**: 117,225

### 生成的文件
```
/tmp/imaging101-local-lqcc8g26/
├── answer.txt (4.3 KB)              ← 最终答案
├── trace.md (4.2 KB)                ← 分析追踪
├── celltype_counts.csv
├── celltype_proportions.csv
├── tumor_enriched_celltypes.csv
├── figures/                         ← 可视化图表
└── src/                             ← 完整代码
```

---

## 📊 第二阶段：LLM Judge 评分 - **待执行**

### 评分标准（9个维度，总分100分）

| 维度 | 分值 | 评估内容 |
|------|------|----------|
| 1. 组织筛选和基线过滤 | 13分 | 正确限制到3个组织（Tumor/Normal/Blood）和基线（Treatment='I'） |
| 2. 细胞亚型分布表构建 | 13分 | 生成 SubCellType × Tissue 频率矩阵 |
| 3. 组织富集指标计算 | 16分 | 使用 Ro/e 或标准化折叠变化 |
| 4. 富集指标解释 | 14分 | 理解富集 vs 耗竭的生物学意义 |
| 5. 肿瘤特异性过滤 | 12分 | 肿瘤中富集 AND 正常/血液中耗竭 |
| 6. 顶级富集细胞识别 | 11分 | 正确识别 SPP1+巨噬细胞、FAP+成纤维细胞等 |
| 7. 统计严谨性 | 7分 | 多重检验校正、报告 p/q 值 |
| 8. 生物学解释 | 9分 | 机制解释、治疗意义、局限性 |
| 9. 来源可靠性 | 0/-5/-10 | 可追溯来源（扣分项） |

### 如何运行 LLM Judge

#### 方法 1：使用任务自带的 test.sh
```bash
cd /data/yjh/biomnibench-organized/da-1-3/evaluation
./test.sh
```

#### 方法 2：直接运行 llm_judge.py
```bash
cd /data/yjh/biomnibench-organized/da-1-3

# 设置环境变量
export ANTHROPIC_API_KEY="00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"

# 运行评估（需要指定 trace.md 和 answer.txt 的位置）
python3 evaluation/llm_judge.py \
  --trace /tmp/imaging101-local-lqcc8g26/trace.md \
  --answer /tmp/imaging101-local-lqcc8g26/answer.txt \
  --rubric evaluation/rubric.txt \
  --output da-1-3_judge_result.json
```

#### 方法 3：检查 test.sh 看具体命令
```bash
cat /data/yjh/biomnibench-organized/da-1-3/evaluation/test.sh
```

---

## 🎯 完整的测试流程

### 对于单个任务（da-1-3）

```bash
# 1. 执行任务（已完成✓）
./test_single_biomnibench.sh da-1-3

# 2. 找到生成的 trace.md 和 answer.txt
WORKSPACE=$(find /tmp -name "imaging101-local-*" -type d | head -1)
echo "Workspace: $WORKSPACE"

# 3. 运行 LLM Judge 评分
cd /data/yjh/biomnibench-organized/da-1-3
export ANTHROPIC_API_KEY="your-api-key"

python3 evaluation/llm_judge.py \
  --trace $WORKSPACE/trace.md \
  --answer $WORKSPACE/answer.txt \
  --rubric evaluation/rubric.txt \
  --output /data/yjh/biomnibench-results/da-1-3/judge_score.json

# 4. 查看评分结果
cat /data/yjh/biomnibench-results/da-1-3/judge_score.json
```

### 对于所有52个任务

需要创建一个批处理脚本：

```bash
#!/bin/bash
# run_all_with_judge.sh

for task_dir in /data/yjh/biomnibench-organized/*/; do
    task_name=$(basename "$task_dir")
    
    # 跳过非任务目录
    if [[ ! "$task_name" =~ ^(da-|conventional) ]]; then
        continue
    fi
    
    echo "处理任务: $task_name"
    
    # 1. 执行任务
    ./test_single_biomnibench.sh "$task_name"
    
    # 2. 找到工作空间
    WORKSPACE=$(find /tmp -name "imaging101-local-*" -type d -newermt "2 minutes ago" | head -1)
    
    if [ -z "$WORKSPACE" ]; then
        echo "⚠️  未找到工作空间"
        continue
    fi
    
    # 3. 运行 LLM Judge
    if [ -f "$WORKSPACE/trace.md" ] && [ -f "$WORKSPACE/answer.txt" ]; then
        cd "$task_dir"
        python3 evaluation/llm_judge.py \
          --trace "$WORKSPACE/trace.md" \
          --answer "$WORKSPACE/answer.txt" \
          --rubric evaluation/rubric.txt \
          --output "/data/yjh/biomnibench-results/$task_name/judge_score.json"
        
        echo "✅ $task_name 评分完成"
    else
        echo "❌ $task_name 缺少输出文件"
    fi
done
```

---

## 📝 评分结果格式

LLM Judge 会生成类似这样的 JSON：

```json
{
  "task_name": "da-1-3",
  "total_score": 85,
  "max_score": 100,
  "criteria_scores": {
    "criterion_1": {"level": "A", "points": 13, "max": 13},
    "criterion_2": {"level": "A", "points": 13, "max": 13},
    "criterion_3": {"level": "B", "points": 10, "max": 16},
    "criterion_4": {"level": "A", "points": 14, "max": 14},
    "criterion_5": {"level": "A", "points": 12, "max": 12},
    "criterion_6": {"level": "B", "points": 7, "max": 11},
    "criterion_7": {"level": "A", "points": 7, "max": 7},
    "criterion_8": {"level": "A", "points": 9, "max": 9},
    "criterion_9": {"level": "A", "points": 0, "max": 0}
  },
  "feedback": {
    "criterion_1": "正确限制到基线和三个组织...",
    "criterion_2": "生成了完整的频率表...",
    ...
  }
}
```

---

## 🚀 下一步建议

### 立即行动

1. **运行 da-1-3 的 LLM Judge** 验证评分系统
   ```bash
   cd /data/yjh/biomnibench-organized/da-1-3/evaluation
   cat test.sh  # 查看具体命令
   ```

2. **为所有任务创建数据链接**
   ```bash
   # 创建批量链接脚本
   ./create_all_data_links.sh
   ```

3. **决定测试策略**
   - 选项 A: 先测试 5-10 个不同类型的任务
   - 选项 B: 直接运行全部 52 个任务

### 预期时间

- **单任务执行**: 15-20 分钟
- **单任务评分**: 2-5 分钟
- **52任务总计**: 约 15-18 小时（串行）

### 成功标准

一个任务算"成功"需要：
1. ✅ 生成 trace.md 和 answer.txt
2. ✅ LLM Judge 评分 ≥ 70 分（根据你的标准调整）
3. ✅ 无致命错误

---

## 📊 预期结果分析

根据 da-1-3 的表现，预计：

- **成功率**: 80-90%
- **平均分**: 70-85 分
- **主要失分点**: 
  - 统计方法选择（Criterion 3）
  - 特定细胞类型识别（Criterion 6）
  - 来源可靠性（Criterion 9）

---

## 💡 关键洞察

1. **任务执行 ≠ 高分** - AI 可能完成任务但方法不够严谨
2. **评分是多维的** - 需要在 9 个维度上都表现良好
3. **生物学理解很重要** - 不仅要算对数字，还要正确解释
4. **来源追溯是扣分项** - 虚构内容会被严厉惩罚

---

**当前状态**: ✅ 任务执行成功，等待 LLM Judge 评分  
**下一步**: 运行 LLM Judge 获取真实分数
