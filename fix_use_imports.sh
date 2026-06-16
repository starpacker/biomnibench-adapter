#!/bin/bash
# 批量替换 React.use 导入

cd /home/yjh/my_claude

files=(
  "src/components/tasks/ShellDetailDialog.tsx"
  "src/tools/FileWriteTool/UI.tsx"
  "src/tools/FileEditTool/UI.tsx"
  "src/screens/Doctor.tsx"
  "src/components/permissions/SedEditPermissionRequest/SedEditPermissionRequest.tsx"
  "src/components/permissions/PermissionExplanation.tsx"
  "src/components/permissions/NotebookEditPermissionRequest/NotebookEditToolDiff.tsx"
  "src/components/FileEditToolDiff.tsx"
  "src/components/HighlightedCode/Fallback.tsx"
  "src/components/permissions/AskUserQuestionPermissionRequest/PreviewBox.tsx"
  "src/components/Markdown.tsx"
  "src/components/StatusNotices.tsx"
  "src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx"
  "src/components/Stats.tsx"
  "src/components/Settings/Status.tsx"
  "src/components/memory/MemoryFileSelector.tsx"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "Processing $file..."
    # 添加 use 的导入
    sed -i "1i import { use } from '../../utils/use.js';" "$file" 2>/dev/null || \
    sed -i "1i import { use } from '../utils/use.js';" "$file" 2>/dev/null || \
    sed -i "1i import { use } from './utils/use.js';" "$file" 2>/dev/null
    
    # 从 React 导入中移除 use
    sed -i "s/, use,/,/g; s/, use}/}/g; s/{use, /{/g; s/{use}/{}/g" "$file"
  fi
done

echo "Done!"
