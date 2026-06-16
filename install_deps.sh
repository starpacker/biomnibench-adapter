#!/bin/bash
# 自动检测并安装缺失的依赖

cd /home/yjh/my_claude

# 添加更多常见依赖
/home/yjh/.bun/bin/bun add env-paths semver commander dotenv \
  ws isomorphic-ws node-fetch cross-fetch \
  yaml js-yaml toml ini \
  glob micromatch braces \
  chokidar fsevents \
  debug ms \
  ora cli-spinners log-symbols \
  boxen wrap-ansi string-width \
  prompts enquirer \
  date-fns dayjs \
  axios got ky \
  tar archiver \
  mime mime-types \
  tmp tempy \
  which-pm-runs which \
  open opener \
  terminal-link hyperlinker

echo "依赖安装完成！"
