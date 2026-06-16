# BioMniBench Data Analysis Skill

## When to use
- Tasks requiring differential expression analysis
- Tasks with large single-cell RNA-seq data (> 1GB)
- Tasks requiring pseudobulk aggregation

## Abstract process
1. **Data exploration phase**: Use small sample reads to understand structure before loading full dataset
2. **Memory-efficient processing**: Use chunked reading or aggregation to avoid ENOMEM errors
3. **Pseudobulk strategy**: Aggregate single-cell data by donor to avoid pseudoreplication
4. **Statistical testing**: Use appropriate tests (Wilcoxon, DESeq2-like) for count data
5. **Documentation discipline**: Write trace.md incrementally during analysis, not at the end

## Anti-patterns to avoid
- Loading entire 12GB h5ad file repeatedly without caching
- Treating single cells as independent samples in statistical tests
- Waiting until timeout to write trace.md

## Validation probe
Before full analysis, run: `python -c "import scanpy; adata = scanpy.read_h5ad('data.h5ad', backed='r'); print(adata.shape)"` 
Expected: Should complete in < 30s and show dimensions

## Stop condition
If memory errors persist after 3 attempts, switch to fully backed mode with selective column loading

## Expected runtime
- Data exploration: 2-5 min
- Pseudobulk aggregation: 5-10 min  
- DE analysis: 3-5 min
- Trace writing: 2-3 min
Total: ~20-25 min for large single-cell tasks

## Evidence requirements
Log file showing successful pseudobulk creation and test statistics
