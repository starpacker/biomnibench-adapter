# Next Action To-Do (2026-06-01)

1. 等待 `output/Bio_runs/34819518_incremental_20260601_014137/` 完成并记录最终停点。  
2. 若你确认继续，重跑 `27959731`（同配置 `--max-rounds 3`），验证增强反馈能否帮助AI修复筛选条件。  
3. 将 `DETAILED_FAILURE_ANALYSIS_WITH_EVIDENCE.md` 的证据结论同步进对外最终报告版本。  
4. 在系统提示中新增“优先遵循 prefix/测试口径列名与变量”的硬约束，重点覆盖：
   - `IMPACT_1P19Q` 优先于同义列
   - 药物筛选优先精确匹配 `==`
   - 生存时间列优先使用 reference/prefix 指定列
