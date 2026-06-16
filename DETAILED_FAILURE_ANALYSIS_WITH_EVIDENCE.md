# 失败任务深入分析报告（补证据版）

**更新时间**: 2026-06-01  
**数据来源**: 最终13个母任务运行目录（2026-05-29 ~ 2026-05-31）

---

## 0) 先回答你最关心的三件事

### A. 是否还需要修评测环境？
**需要小修1处，已完成。**
- 问题: `n_msi.json` 这类 `{"n_msi": 18}` 会被评测器先绑定成 `n_msi=dict`，导致 `int(n_msi)` 报错。
- 修复文件: `incremental_evaluator.py`
- 修复后复评结果: `34819518_2` 已从 ERROR 变为 **PASS**。

### B. 是否需要重跑信息不足任务？
- **必须重跑**: `34819518`（因为之前失败由评测器bug导致，不是AI逻辑）。
- **可选重跑**: `27959731`（不是环境问题，但可用新反馈观察AI是否能修正 `<1`→`isin(['0','1'])`）。
- **其余 28472509/28481359/28985567/29713087/30742119/32437664**: 当前证据已充分，**不需要为了“查原因”而重跑**。

### C. 还是只分析已有日志？
- 对于大多数失败案例，**已有日志+代码+测试+数据已足够定性**。
- 仅 `34819518_2` 需要“修评测器+复评”来排除环境假阳性。

---

## 1) 日志清理状态（已执行）

### 已归档（环境修复前/无效）
- `logs/archive_invalid_pre_envfix_20260528/`
  - `batch_runs/*.log`（13个 combined + 1个 batch 汇总）
  - `method2_batch_20260528_204401.log`
  - `method2_batch_20260528_204423.log`
  - `method2_study25303977_failfast_20260528_205809.log`

### 已保留（有效13条母任务轨迹）
- `logs/valid_13_trajectories/`
  - `manifest.tsv`（13个母任务到选定轨迹的映射）
  - 每个母任务1条 `*_trajectory.clean.jsonl`
  - 每个母任务对应 `*_study_state.json`

---

## 2) 你提的8个问题：逐条证据 + 明确结论

## 问题1: `1134819518_2`（应为 `34819518_2`）为什么 `n_msi` 明明定义了还报错？

### 证据
- AI代码（Round 3）在 `output/Bio_runs/34819518_incremental_20260531_205311/34819518_2_20260531_210156/workspace/solve.py`:
  - `n_msi = int(...)`
  - 输出 `outputs/n_msi.json` 为 `{"n_msi": 18}`
- 原失败结果: `TypeError: int() argument ... not 'dict'`
- 测试: `assert int(n_msi) == 18`

### 根因（确定）
不是AI没定义变量，而是**评测器加载JSON时把 `n_msi` 绑定成了 dict**，导致 `int(n_msi)` 报错。

### 处理结果
- 已修 `incremental_evaluator.py`（字典展开与同名键冲突逻辑）。
- 已复评：`34819518_2` => **PASS**。

---

## 问题2: `27959731_1` 筛选条件错误，你要肯定答复

### 证据
- AI代码（Round 3）: `PERFORMANCE_STATUS_NUM < 1`
- 参考答案: `PERFORMANCE_STATUS.isin(['0','1'])`
- 数据统计:
  - `PERFORMANCE_STATUS='0'`: 37
  - `PERFORMANCE_STATUS='1'`: 45
  - AI筛选行数（<1）: 37
  - 参考筛选行数（0/1）: 82
- 结果对比:
  - 参考 `len(output_df)=13`, `CYCLES_COMPLETED=7` 的 `count=5`
  - AI   `len(output_df)=8`,  `CYCLES_COMPLETED=7` 的 `count=2`

### 结论（确定）
**就是筛选条件写错**，不是“可能”。应从 `<1` 改为 `isin(['0','1'])`（或逻辑等价写法）。

---

## 问题3: `28472509_4` 列名选择错误，为什么会选这个列？

### 证据
- AI代码用: `IDH_1P19Q_SUBTYPE == 'Co-deleted'`
- 测试/参考用: `IMPACT_1P19Q == 'Co-deleted'`
- 数据中两列都存在且不完全一致:
  - `IDH_1P19Q_SUBTYPE='Co-deleted'` 患者数: 15
  - `IMPACT_1P19Q='Co-deleted'` 患者数: 14
  - 有1个冲突患者: `p_AO_odg_008`（前者Co-deleted，后者Not deleted）

### 更深层原因
AI在语义上偏向“看起来更具体/更医学化”的列名（`IDH_..._SUBTYPE`），但评测合同是 `IMPACT_1P19Q`。这是**同义列竞争导致的 schema grounding 错位**，不是随机错误。

### 结论
这是**列选择偏差 + 评测口径不一致**引起的确定性失败。

---

## 问题4: `28481359_5` 没看到AI代码、为什么错？

### 证据
- Round 3 AI代码在: `output/Bio_runs/28481359_incremental_20260531_135852/28481359_5_20260531_141425/workspace/solver.py`
- 测试断言: `abs(np.mean(output_ar[0]) - 11.036491228070176) <= 1e-8`
- 关键对比:
  - 参考实现按 `TP53` 均值 **降序** 排癌种
  - AI实现按 `TP53` 均值 **升序** 排癌种
- 数值证据:
  - 参考 `np.mean(output_ar[0]) = 11.036491228070176`
  - AI    `np.mean(output_ar[0]) = 10.080943396226417`

### 结论
失败原因明确：**排序方向反了（ascending=True vs False）**。

---

## 问题5: `28985567_5`（你说没证据）

### 证据
- AI代码: `.../28985567_5_20260531_162355/workspace/solve.py`
- 参考流程来自 prefix + reference:
  - 用 `IPI` 构造 `Risk Group`（Low/Intermediate/High）
  - KM 拟合时未传 `event_observed`（等价于全事件）
- 期望（测试）:
  - `kmf_low.event_observed.sum()==243`
  - `kmf_middle.event_observed.sum()==370`
  - `kmf_high.event_observed.sum()==143`
- AI实际逻辑:
  - merge sample 的 `PROGNOSTIC_MODEL` + `CENSORED`
  - 组别变为 `Low risk/Medium risk/High risk`
  - AI事件和组规模显著偏离

### 结论
这是**任务口径错位**：AI没跟 prefix 的 `Risk Group(IPI)` 口径，改成了另一个数据源和事件定义。

---

## 问题6: `29713087_2`（你说没证据）

### 证据
- AI代码: `.../29713087_2_20260531_163919/workspace/solve.py`
- prefix定义显著基因: `q < 0.1`
- AI改成: `q < 0.05`
- 数据证据:
  - `q < 0.1` 基因数: 98
  - `q < 0.05` 基因数: 87
- 另一个关键偏差:
  - 参考 `Frame shift` 用精确匹配 `Frame_Shift`（结果应为0）
  - AI用 `['Frame_Shift_Del','Frame_Shift_Ins']`（会计入67条）

### 结论
不是环境问题，是**两处确定性逻辑偏差**：阈值错 + Frame shift定义错。

---

## 问题7: `30742119_6`（你说没证据）

### 证据
- AI代码: `.../30742119_6_20260531_170909/workspace/solve_kmf.py`
- 参考逻辑:
  - 药物筛选用精确匹配 `== 'Nivolumab' / 'Pembrolizumab'`
  - 生存时间列用 `OS_FROM_PD1I_MONTHS`
- AI逻辑:
  - 药物筛选用 `str.contains`（包含联合用药）
  - 时间列用 `PFS_MONTHS`
- 数值证据:
  - 测试期望事件数: Niv=9, Pem=3
  - AI口径事件数: Niv=10, Pem=4

### 结论
失败由**药物筛选口径+时间列选择双重偏差**导致，证据充分。

---

## 问题8: `32437664_10`（你说没证据）

### 证据
- AI代码: `.../32437664_10_20260531_180209/workspace/solve.py`
- 参考逻辑用列:
  - `BASELINE_ERBB2_TISSUE_NGS`
  - `BASELINE_ERBB2_PLASMA_NGS`
  - 且识别值含 `Focal gain*`
- AI逻辑用列:
  - `BASELINE_ERBB2_ANY_NGS`
  - `ERBB2_AMP_MSKIMPACT`
  - 识别 `Focal gain`（无星号）
- 数值证据:
  - 期望分布: `{amplification_or_focal_gain: 43, wildtype: 25}`
  - AI分布: `{amplification_or_focal_gain: 23, wildtype: 14}`（仅37人）

### 结论
失败由**错误特征列 + 值域口径不一致 + 去重口径差异**共同造成。

---

## 3) 已完成代码修改

### 修改1：修复 dict 输出覆盖变量问题（关键）
- 文件: `incremental_evaluator.py`
- 影响: 修复 `n_msi.json` / `results.json` 类命名冲突

### 修改2：断言反馈增强
- 文件: `incremental_evaluator.py`
- 影响: `Assertion failed` 反馈会显示真实断言语句，不再只有 `<traceback object ...>`

### 修改3：可用变量列表筛选逻辑修正
- 文件: `incremental_evaluator.py`

---

## 4) 已执行运行/复评

1. **复评 `34819518_2`（修复后）**
   - 结果: **PASS**
   - 结论: 之前失败属于评测器加载逻辑问题。

2. **复评 `27959731_1`（同一AI输出）**
   - 结果: **FAIL**
   - 明确断言: `assert len(output_df) == 13`
   - 结论: 非环境问题，确属筛选条件错误。

3. **启动母任务 `34819518` 重跑**
   - 新目录: `output/Bio_runs/34819518_incremental_20260601_014137/`
   - 当前状态: 运行中（后续按新结果更新）。

---

## 5) 下一步 To-Do（按优先级）

1. 等待 `34819518` 重跑完成，确认母任务级成功率变化。  
2. 若你同意，重跑 `27959731`（目标仅验证AI在增强反馈下能否自修）。  
3. 将 `FINAL_13_TASKS_COMPREHENSIVE_REPORT.md` 的失败分析段替换为本文件的证据化版本。  
4. 在系统提示增加“严格遵循 prefix 变量/列口径”的规则，重点防止 28985567/29713087/30742119/32437664 类型偏差。  

