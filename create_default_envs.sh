#!/bin/bash

# 为所有没有envs的子任务创建默认envs配置

echo "=== 为没有envs的子任务创建默认envs配置 ==="
echo ""

STUDIES=("32864625:6" "34819518:6" "29713087:7" "30742119:8" "28481359:9" "28985567:9" "27959731:10" "28472509:10" "30867592:10" "37699004:10" "33765338:12" "32437664:13")

CREATED=0

for study_info in "${STUDIES[@]}"; do
    STUDY_ID=$(echo "$study_info" | cut -d: -f1)
    SUBTASK_COUNT=$(echo "$study_info" | cut -d: -f2)
    
    echo "处理母任务 $STUDY_ID ($SUBTASK_COUNT 个子任务)..."
    
    for i in $(seq 0 $((SUBTASK_COUNT - 1))); do
        TASK_DIR="tasks/${STUDY_ID}_${i}"
        ENVS_DIR="$TASK_DIR/envs"
        
        if [ ! -d "$ENVS_DIR" ]; then
            # 创建envs目录结构
            mkdir -p "$ENVS_DIR/runtime/.venv/bin"
            
            # 创建env_manifest.json
            cat > "$ENVS_DIR/env_manifest.json" << 'EOF'
{
  "default_env": "runtime",
  "envs": {
    "runtime": {
      "python": {
        "posix": "envs/runtime/.venv/bin/python"
      }
    }
  }
}
EOF
            
            # 创建指向系统Python的符号链接
            ln -sf $(which python3) "$ENVS_DIR/runtime/.venv/bin/python"
            
            # 更新task_manifest.json以包含envs
            MANIFEST_FILE="$TASK_DIR/task_manifest.json"
            if [ -f "$MANIFEST_FILE" ]; then
                # 使用Python更新JSON
                python3 << PYTHON_EOF
import json

with open('$MANIFEST_FILE', 'r') as f:
    manifest = json.load(f)

# 添加envs到public_bundle
if 'envs' not in manifest.get('public_bundle', []):
    manifest['public_bundle'].append('envs')

# 添加environment到entrypoints
if 'environment' not in manifest.get('entrypoints', {}):
    manifest['entrypoints']['environment'] = 'envs/env_manifest.json'

with open('$MANIFEST_FILE', 'w') as f:
    json.dump(manifest, f, indent=2)
PYTHON_EOF
            fi
            
            echo "  ✅ 创建 ${STUDY_ID}_${i}/envs"
            CREATED=$((CREATED + 1))
        else
            echo "  ⏭️  ${STUDY_ID}_${i}/envs 已存在"
        fi
    done
    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "完成！共创建 $CREATED 个 envs 配置"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
