import pandas as pd
import numpy as np
from scipy.stats import pearsonr, spearmanr
from scipy.cluster.hierarchy import linkage, dendrogram, fcluster, cophenet
from scipy.spatial.distance import squareform
from sklearn.metrics import silhouette_score
import warnings
warnings.filterwarnings('ignore')

DATA_PATH = "/data/yjh/skill-opt/repo/outputs/skillopt_biomnibench_Vendor3-DeepSeek-V4-Flash_20260831_131414/steps/step_0015/rollout/runs/da-14-1/da-14-1_skillopt_da-14-1_1788199733/public/envs/data/subspace_score_table.csv"

# Step 1: Load data
print("=" * 60)
print("STEP 1: Load and inspect data")
print("=" * 60)
df = pd.read_csv(DATA_PATH)
print(f"Shape: {df.shape}")
print(f"Total patients: {df.shape[0]}")
print(f"Total columns: {df.shape[1]}")
print()

# List all columns
print("All columns:")
for i, col in enumerate(df.columns):
    print(f"  {i:3d}: {col} (dtype={df[col].dtype})")
print()

# Check missing values
print("Missing values per column:")
missing = df.isnull().sum()
missing_pct = df.isnull().mean() * 100
miss_df = pd.DataFrame({'missing': missing, 'pct': missing_pct})
miss_df = miss_df[miss_df['missing'] > 0].sort_values('missing', ascending=False)
print(miss_df)
print(f"\nColumns with any missing: {len(miss_df)}")
print(f"Columns with no missing: {df.shape[1] - len(miss_df)}")

# Step 2: Define score columns
print("\n" + "=" * 60)
print("STEP 2: Select score features")
print("=" * 60)

# Core score columns (numeric, continuous) - exclude probability, categorical, clinical
score_cols = [
    # Myeloid/lymphoid subspace
    'mod1_score', 'mod2_score', 'mod3_score', 'mod4_score',
    'detrimental_score', 'protective_score', 'som_score',
    # Sweeney
    'inflammopathic_score', 'adaptive_score', 'coagulopathic_score',
    # Yao
    'yao_IA_score', 'yao_IC_score', 'yao_IN_score',
    # Wong
    'wong_score',
    # Davenport SRS
    'davenport_SRSq',
    # Cano SRS
    'cano_SRSq',
    # MARS
    'mars1_score', 'mars2_score', 'mars3_score', 'mars4_score',
    # Bespoke myeloid/lymphoid
    'myeloid_detrimental_score', 'neutrophil_protective_score',
    'monocyte_protective_score', 'myeloid_protective_score',
    'lymphoid_protective_score', 'lymphoid_score', 'myeloid_score',
    # Z-scores
    'lymphoid_z_score', 'myeloid_z_score'
]

print(f"Selected {len(score_cols)} score columns")
# Check which ones exist
existing_cols = [c for c in score_cols if c in df.columns]
missing_cols = [c for c in score_cols if c not in df.columns]
print(f"Existing: {len(existing_cols)}")
print(f"Missing from data: {missing_cols}")
score_cols = existing_cols

# Check missing values in score columns
score_missing = df[score_cols].isnull().sum()
print(f"\nScore columns with missing values:")
print(score_missing[score_missing > 0] if any(score_missing > 0) else "None have missing values")

# Check for non-numeric columns
for col in score_cols:
    if not pd.api.types.is_numeric_dtype(df[col]):
        print(f"WARNING: {col} is not numeric: {df[col].dtype}")

# Step 3: Compute correlation matrix
print("\n" + "=" * 60)
print("STEP 3: Compute pairwise score correlations")
print("=" * 60)

score_df = df[score_cols].copy()

# Drop rows with any missing in score columns
initial_n = len(score_df)
score_df = score_df.dropna()
print(f"Patients after dropping NA in score columns: {len(score_df)} (dropped {initial_n - len(score_df)})")

# Pearson correlation
corr_pearson = score_df.corr(method='pearson')
print(f"\nPearson correlation matrix shape: {corr_pearson.shape}")

# Spearman correlation
corr_spearman = score_df.corr(method='spearman')
print(f"Spearman correlation matrix shape: {corr_spearman.shape}")

# Print correlation matrix
print("\nPearson correlation matrix (rounded to 3 decimals):")
print(corr_pearson.to_string(float_format=lambda x: f"{x:.3f}"))

# Step 4: Hierarchical clustering
print("\n" + "=" * 60)
print("STEP 4: Hierarchical clustering")
print("=" * 60)

# Convert correlation to distance: d = 1 - corr (for positive correlations)
# Or use 1 - |corr| to treat both positive and negative correlations as similarity
dist_pearson = 1 - corr_pearson.abs()
dist_spearman = 1 - corr_spearman.abs()

print("Using distance = 1 - |correlation|")

# Complete linkage
Z_pearson = linkage(squareform(dist_pearson.values), method='complete')
Z_spearman = linkage(squareform(dist_spearman.values), method='complete')

# Ward linkage
Z_pearson_ward = linkage(squareform(dist_pearson.values), method='ward')
Z_spearman_ward = linkage(squareform(dist_spearman.values), method='ward')

# Print linkage matrices
print("\nPearson+Complete linkage (first 5 merges):")
for i in range(min(5, len(Z_pearson))):
    print(f"  Merge {i}: clusters {int(Z_pearson[i,0])} and {int(Z_pearson[i,1])}, distance={Z_pearson[i,2]:.4f}, size={int(Z_pearson[i,3])}")

# Step 5: Determine cluster structure
print("\n" + "=" * 60)
print("STEP 5: Determine cluster structure")
print("=" * 60)

# Test different numbers of clusters
print("Silhouette scores for different cluster counts (Pearson+Complete):")
for k in range(2, 10):
    labels = fcluster(Z_pearson, k, criterion='maxclust')
    # Silhouette needs at least 2 clusters and not all in one
    if len(set(labels)) > 1:
        sil = silhouette_score(dist_pearson.values, labels, metric='precomputed')
        print(f"  k={k}: silhouette = {sil:.4f}")

print("\nSilhouette scores for different cluster counts (Pearson+Ward):")
for k in range(2, 10):
    labels = fcluster(Z_pearson_ward, k, criterion='maxclust')
    if len(set(labels)) > 1:
        sil = silhouette_score(dist_pearson.values, labels, metric='precomputed')
        print(f"  k={k}: silhouette = {sil:.4f}")

# Step 6: Extract and interpret clusters
print("\n" + "=" * 60)
print("STEP 6: Interpret clusters (k=3, Pearson+Complete)")
print("=" * 60)

# Choose k based on silhouette
k_optimal = 3
labels_pearson_complete = fcluster(Z_pearson, k_optimal, criterion='maxclust')

print(f"Cluster assignments (k={k_optimal}):")
for i, (col, label) in enumerate(zip(score_cols, labels_pearson_complete)):
    print(f"  {col:40s} -> Cluster {label}")

print("\nClusters with their members:")
for cluster_id in sorted(set(labels_pearson_complete)):
    members = [col for col, lbl in zip(score_cols, labels_pearson_complete) if lbl == cluster_id]
    print(f"\n  Cluster {cluster_id} ({len(members)} signatures):")
    for m in members:
        print(f"    - {m}")

# Also check k=2 and k=4
for k_check in [2, 4]:
    print(f"\n" + "=" * 60)
    print(f"Alternative: k={k_check} clusters (Pearson+Complete)")
    print("=" * 60)
    labels_alt = fcluster(Z_pearson, k_check, criterion='maxclust')
    for cluster_id in sorted(set(labels_alt)):
        members = [col for col, lbl in zip(score_cols, labels_alt) if lbl == cluster_id]
        print(f"  Cluster {cluster_id} ({len(members)} signatures):")
        for m in members:
            print(f"    - {m}")

# Step 7: Detailed correlation analysis within/between clusters
print("\n" + "=" * 60)
print("STEP 7: Within-cluster vs between-cluster correlations")
print("=" * 60)

labels = labels_pearson_complete
for cluster_id in sorted(set(labels)):
    members = [col for col, lbl in zip(score_cols, labels) if lbl == cluster_id]
    if len(members) > 1:
        sub_corr = corr_pearson.loc[members, members]
        # Mean of upper triangle (excluding diagonal)
        triu_vals = sub_corr.where(np.triu(np.ones(sub_corr.shape), k=1).astype(bool)).stack()
        mean_within = triu_vals.mean()
        print(f"  Cluster {cluster_id}: mean within-cluster r = {mean_within:.4f} (n={len(members)} signatures)")
        print(f"    Pairwise correlations:")
        for pair_name, val in triu_vals.items():
            print(f"      {pair_name[0]} vs {pair_name[1]}: r = {val:.4f}")

# Between-cluster correlations
print("\n  Between-cluster mean correlations:")
for c1 in sorted(set(labels)):
    for c2 in sorted(set(labels)):
        if c1 < c2:
            m1 = [col for col, lbl in zip(score_cols, labels) if lbl == c1]
            m2 = [col for col, lbl in zip(score_cols, labels) if lbl == c2]
            cross = corr_pearson.loc[m1, m2]
            mean_cross = cross.values.mean()
            print(f"    Cluster {c1} vs Cluster {c2}: mean r = {mean_cross:.4f}")

# Step 8: Validate with Spearman
print("\n" + "=" * 60)
print("STEP 8: Validation with Spearman correlation")
print("=" * 60)

labels_spearman = fcluster(Z_spearman, k_optimal, criterion='maxclust')
print(f"Spearman+Complete cluster assignments (k={k_optimal}):")
for cluster_id in sorted(set(labels_spearman)):
    members = [col for col, lbl in zip(score_cols, labels_spearman) if lbl == cluster_id]
    print(f"  Cluster {cluster_id} ({len(members)} signatures):")
    for m in members:
        print(f"    - {m}")

# Check agreement
from collections import Counter
agreement = sum(1 for a, b in zip(labels_pearson_complete, labels_spearman) if a == b)
print(f"\nAgreement between Pearson and Spearman cluster assignments: {agreement}/{len(score_cols)}")

# Also check Ward
labels_pearson_ward = fcluster(Z_pearson_ward, k_optimal, criterion='maxclust')
print(f"\nPearson+Ward cluster assignments (k={k_optimal}):")
for cluster_id in sorted(set(labels_pearson_ward)):
    members = [col for col, lbl in zip(score_cols, labels_pearson_ward) if lbl == cluster_id]
    print(f"  Cluster {cluster_id} ({len(members)} signatures):")
    for m in members:
        print(f"    - {m}")

# Finally, print the full correlation matrix with nice formatting for the trace
print("\n" + "=" * 60)
print("FULL CORRELATION MATRIX (for trace)")
print("=" * 60)

# Create a nicely formatted version
print(corr_pearson.to_string(float_format=lambda x: f"{x:.3f}"))

# Save correlation matrix for later use
print("\nSaving correlation matrix...")
corr_pearson.to_csv("workspace/experiments/correlation_matrix.csv")
print("Done!")
