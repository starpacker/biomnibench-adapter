#!/bin/bash

# 为所有子任务生成 task_manifest.json

echo "=== 为所有子任务生成 task_manifest.json ==="
echo ""

STUDIES=(
    "32864625:6"
    "34819518:6"
    "29713087:7"
    "30742119:8"
    "28481359:9"
    "28985567:9"
    "27959731:10"
    "28472509:10"
    "30867592:10"
    "37699004:10"
    "33765338:12"
    "32437664:13"
)

TOTAL_CREATED=0

for study_info in "${STUDIES[@]}"; do
    STUDY_ID=$(echo "$study_info" | cut -d: -f1)
    SUBTASK_COUNT=$(echo "$study_info" | cut -d: -f2)
    
    echo "处理母任务 $STUDY_ID ($SUBTASK_COUNT 个子任务)..."
    
    for i in $(seq 0 $((SUBTASK_COUNT - 1))); do
        TASK_DIR="tasks/${STUDY_ID}_${i}"
        MANIFEST_FILE="$TASK_DIR/task_manifest.json"
        
        if [ ! -f "$MANIFEST_FILE" ]; then
            # 检查是否有envs目录
            if [ -d "$TASK_DIR/envs" ]; then
                ENV_LINE='    "environment": "envs/env_manifest.json"'
                PUBLIC_BUNDLE='    "envs"'
            else
                ENV_LINE=''
                PUBLIC_BUNDLE=''
            fi
            
            # 生成task_manifest.json
            cat > "$MANIFEST_FILE" << EOF
{
  "version": 1,
  "task_id": "${STUDY_ID}_${i}",
  "public_bundle": [
    "README.md",
    "queries.md",
    "cot_instructions.md",
    "requirements.txt",
    "workdir"$([ -n "$PUBLIC_BUNDLE" ] && echo "," || echo "")
$([ -n "$PUBLIC_BUNDLE" ] && echo "$PUBLIC_BUNDLE" || echo "")
  ],
  "private_judge_bundle": [
    "evaluation"
  ],
  "entrypoints": {
    "judge": "evaluation/test_cases.py"$([ -n "$ENV_LINE" ] && echo "," || echo "")
$([ -n "$ENV_LINE" ] && echo "$ENV_LINE" || echo "")
  },
  "submission": {
    "output_dir": "outputs"
  }
}
EOF
            echo "  ✅ 创建 ${STUDY_ID}_${i}/task_manifest.json"
            TOTAL_CREATED=$((TOTAL_CREATED + 1))
        else
            echo "  ⏭️  ${STUDY_ID}_${i}/task_manifest.json 已存在"
        fi
    done
    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "完成！共创建 $TOTAL_CREATED 个 task_manifest.json 文件"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
