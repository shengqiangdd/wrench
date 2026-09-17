#!/usr/bin/env bash
# check-secrets.sh —— 明文凭据扫描（提交前 / CI 共用同一份规则）
#
# 为什么有这东西：2026-09 之前仓库里进过 `deploy*.py`，里面写着服务器 IP + 用户名 +
# 明文口令，而仓库是 **public** 的。文件后来删了，但**删除只影响 HEAD，不影响历史** ——
# `git log -p` 至今仍能翻出来。规则表把这类东西挡在提交之前。
#
# 用法：
#   tools/check-secrets.sh                   扫「已跟踪文件」的工作区内容（CI 用，快）
#   tools/check-secrets.sh --staged          只扫暂存区（pre-commit 用，最快）
#   tools/check-secrets.sh --history         扫全历史（按提交报告，慢，每周跑一次）
#
# 退出码：0 = 干净，1 = 命中，2 = 参数错。
#
# 本地追加自定义禁止串（不想写进仓库的具体凭据）：每行一个串，写进
#   $WRENCH_SECRET_DENYLIST（默认 ~/.wrench-secret-denylist）
# 该文件不被仓库跟踪；命中即拒绝提交。CI 里通常没有它，属正常。
set -uo pipefail

MODE="tree"
case "${1:-}" in
  --staged) MODE="staged" ;;
  --history | --all-history-objects) MODE="history" ;;
  "") ;;
  *) echo "未知参数: $1" >&2; exit 2 ;;
esac

# ── 规则表：名字|POSIX ERE|人话 ──
# 只放**高信号**模式：宁可漏一点，也不要天天误报 —— 误报成惯例的门禁最后都会被
# `--no-verify` 绕掉，等于没开。
RULES=(
  'private-key|-----BEGIN [A-Z ]*PRIVATE KEY-----|私钥内容（PEM/OpenSSH）'
  'github-token|gh[pousr]_[0-9A-Za-z]{36}|GitHub 令牌'
  'github-pat|github_pat_[0-9A-Za-z_]{30}|GitHub fine-grained PAT'
  'aws-access-key|AKIA[0-9A-Z]{16}|AWS Access Key ID'
  'slack-token|xox[abprs]-[0-9A-Za-z-]{10}|Slack 令牌'
  'api-key-sk|sk-[A-Za-z0-9_-]{32}|带 sk- 前缀的 API key'
  'sshpass-pw|sshpass +-p +[^-][^ 	]+|命令行明文 SSH 口令'
)

# ── 「赋值式凭据」规则：只在会被真部署的代码里查，且排除测试/示例/文档 ──
# `password: "xxx"` 在测试夹具里到处都是，一刀切会把门禁变成噪声源。
ASSIGN_RE='(password|passwd|passphrase|secret|api[_-]?key|access[_-]?token)[[:space:]]*[:=][[:space:]]*"[^"]{6,}"'

# 允许放行：行内带这个标记的，视为刻意为之（文档示例、UI 提示文案等）
ALLOW_MARKER='secret-scan:ignore'

# ── 本地禁止串（不进仓库）──
DENYLIST="${WRENCH_SECRET_DENYLIST:-$HOME/.wrench-secret-denylist}"
DENY=()
if [ -f "$DENYLIST" ]; then
  while IFS= read -r secret; do
    [ -n "$secret" ] || continue
    case "$secret" in \#*) continue ;; esac
    DENY+=("$secret")
  done < "$DENYLIST"
fi

fail=0
mask_note='（内容不回显：扫描器本身不该变成泄露渠道）'

# ── 单文件扫描（tree / staged 模式）──
scan_file() {
  local f="$1" rule name re desc line_no content
  [ -f "$f" ] || return 0
  grep -Iq . "$f" 2>/dev/null || return 0   # 二进制不扫（core dump / 图片会刷屏）

  for rule in "${RULES[@]}"; do
    IFS='|' read -r name re desc <<<"$rule"
    while IFS=: read -r line_no content; do
      [ -n "${line_no:-}" ] || continue
      case "$content" in *"$ALLOW_MARKER"*) continue ;; esac
      # `placeholder="-----BEGIN RSA PRIVATE KEY-----…"` 是界面提示文案，不是密钥
      case "$name:$content" in private-key:*placeholder*) continue ;; esac
      # `sshpass -p <口令>` / `-p $VAR` / `-p …` 是文档里的占位写法，不是真值
      if [ "$name" = "sshpass-pw" ]; then
        case "$content" in
          *'sshpass -p <'* | *'sshpass -p $'* | *'sshpass -p …'* | *"$ALLOW_MARKER"*) continue ;;
        esac
      fi
      printf '❌ [%s] %s:%s  命中：%s\n' "$name" "$f" "$line_no" "$desc"
      fail=1
    done < <(grep -nIE -- "$re" "$f" 2>/dev/null)
  done

  # 赋值式凭据：排除测试、示例、文档与本脚本自身。
  # 注意只对**这一条**放宽 —— 私钥/令牌那几条高信号规则在测试文件里也照报
  # （测试夹具里出现真令牌同样是泄露）。
  case "$f" in
    frontend/src/test/*|*/src/test/*|*/tests/*|*test*/*|*.test.ts|*.test.tsx|*.spec.ts) return 0 ;;
    *.md|*.example|*.sample|*.mdx|.env*) return 0 ;;
    tools/check-secrets.sh) return 0 ;;
  esac
  # Rust 的 `#[cfg(test)] mod tests { … }` 按惯例是文件尾部一整块，
  # 里面的 `jwt_secret: "test-jwt-secret"` 是夹具不是凭据 —— 从 cfg(test) 行起不查本规则。
  local rust_test_start=""
  case "$f" in
    *.rs) rust_test_start=$(grep -n 'cfg(test)' "$f" 2>/dev/null | head -1 | cut -d: -f1) ;;
  esac
  while IFS=: read -r line_no content; do
    [ -n "${line_no:-}" ] || continue
    case "$content" in *"$ALLOW_MARKER"*) continue ;; esac
    if [ -n "$rust_test_start" ] && [ "$line_no" -ge "$rust_test_start" ]; then continue; fi
    printf '❌ [hardcoded-credential] %s:%s  形如 password/secret = "字面量"：真实兜底应来自环境变量或 Vault\n' "$f" "$line_no"
    fail=1
  done < <(grep -nIE -- "$ASSIGN_RE" "$f" 2>/dev/null)
}

if [ "$MODE" = "history" ]; then
  # 按提交报告（`git log -G`），而不是逐个 blob 翻 —— 后者在两万多个对象上要跑十分钟。
  # 命中里夹着历史噪声：早期 `frontend/node_modules/**` 与 `frontend/dist/**` 曾被跟踪，
  # 第三方打包产物的字符串会撞上 AKIA / sk- / PRIVATE KEY 这几条（`5d53c750` 已移除跟踪）。
  for rule in "${RULES[@]}"; do
    IFS='|' read -r name re desc <<<"$rule"
    hits=$(git log --all -G"$re" --format='%h' 2>/dev/null | sort -u | head -10 | tr '\n' ' ')
    if [ -n "$hits" ]; then
      printf '❌ [%s] 历史命中：%s（%s）\n' "$name" "$desc" "$hits"
      fail=1
    fi
  done
  for secret in ${DENY[@]+"${DENY[@]}"}; do
    hits=$(git log --all -S"$secret" --format='%h' 2>/dev/null | sort -u | head -10 | tr '\n' ' ')
    if [ -n "$hits" ]; then
      printf '❌ [local-denylist] 历史命中本机禁止串（长度 %s）于提交：%s\n' "${#secret}" "$hits"
      fail=1
    fi
  done
  if [ "$fail" -eq 0 ]; then
    echo "✅ 历史扫描通过（未发现私钥/令牌/本机禁止串）"
  else
    echo ""
    echo "历史命中**改不动**（push 出去就已经公开）：能做的只有轮换凭据，"
    echo "以及必要时用 git-filter-repo 重写历史 + force push（需先和用户确认，见 docs/DEPLOY.md）。"
  fi
  exit "$fail"
fi

while read -r f; do
  [ -n "$f" ] || continue
  scan_file "$f"
done < <(if [ "$MODE" = "staged" ]; then git diff --cached --name-only --diff-filter=ACMR; else git ls-files; fi)

for secret in ${DENY[@]+"${DENY[@]}"}; do
  case "$MODE" in
    staged)
      if git diff --cached -U0 2>/dev/null | grep -IqF -- "$secret"; then
        printf '❌ [local-denylist] 暂存内容命中本机禁止串（长度 %s）%s\n' "${#secret}" "$mask_note"
        fail=1
      fi ;;
    *)
      if git grep -qF -- "$secret" 2>/dev/null; then
        printf '❌ [local-denylist] 工作区命中本机禁止串（长度 %s）—— 位置：\n' "${#secret}"
        git grep -nF -- "$secret" 2>/dev/null | cut -d: -f1 | sort -u | head -10
        fail=1
      fi ;;
  esac
done

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "请把凭据挪到环境变量 / Vault（见 docs/ARCHITECTURE.md 的安全章节）。"
  echo "确属示例或误报：在该行加注释标记 '$ALLOW_MARKER'。"
  exit 1
fi
echo "✅ 明文凭据扫描通过"
exit 0
