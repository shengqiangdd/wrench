#!/bin/sh
# check-rust-modules.sh —— 确保 backend/src 下每个 .rs 文件都真的会被 cargo 编译。
#
# 为什么有这东西：仓库里出现过 `src/ssh/known_hosts_test.rs` 这种「孤儿文件」——
# 文件躺在源码树里，但没有任何 `mod` 声明引用它，于是 cargo 从不编译它、CI 的测试
# 数量里也没有它。「看起来有覆盖、实际一行都没跑」比没有测试更危险，而这类文件
# 只靠人肉 review 才发现得了（`cargo fmt` / `clippy` / `test` 都不会碰它）。
#
# 判定规则（只看同目录的 mod 声明，简单、可离线跑、不误报）：
#   - crate 根 `src/main.rs`、`src/lib.rs`：入口，不需要被声明
#   - `src/bin/**`：cargo 自动发现的 bin target，按约定不需要 mod 声明
#   - `src/a/b.rs`      → 需要 `src/a/` 里某个 .rs 有 `mod b;`
#   - `src/a/b/mod.rs`  → 需要 `src/`   里某个 .rs 有 `mod b;`
#
# 已知不覆盖：`#[path = "..."]` 重定向（本仓库未使用）。真用了就按需扩展。
#
# 用 POSIX sh 写（pre-commit 钩子在 dash 下执行），不依赖 bash。
# 用法：check-rust-modules.sh     退出码 0 = 干净，1 = 发现孤儿，2 = 环境问题。
set -u

cd "$(dirname "$0")/.." || exit 2
root="backend/src"
[ -d "$root" ] || { echo "找不到 $root（请在仓库根运行）" >&2; exit 2; }

orphans=$(mktemp) || exit 2
trap 'rm -f "$orphans"' EXIT INT TERM

find "$root" -name '*.rs' | sort | while IFS= read -r file; do
  case "$file" in
    "$root/main.rs" | "$root/lib.rs") continue ;;
    "$root/bin/"*) continue ;;
  esac

  dir=$(dirname "$file")
  base=$(basename "$file")
  if [ "$base" = "mod.rs" ]; then
    modname=$(basename "$dir")
    searchdir=$(dirname "$dir")
  else
    modname=${base%.rs}
    searchdir="$dir"
  fi

  # 在 searchdir 的 .rs 文件里找 `mod <modname>;`（允许 pub / pub(crate) 等可见性前缀）
  if ! grep -rqE \
      "^[[:space:]]*(pub([[:space:]]*\([^)]*\))?[[:space:]]+)?mod[[:space:]]+${modname}[[:space:]]*;" \
      --include='*.rs' "$searchdir"; then
    printf '%s\n' "$file" >>"$orphans"
  fi
done

if [ -s "$orphans" ]; then
  while IFS= read -r file; do
    printf '❌ 孤儿 Rust 文件（没有任何 mod 声明，cargo 从不编译它）：%s\n' "$file"
  done <"$orphans"
  echo ""
  echo "修法：要么在所属模块里加上 mod 声明把它接进模块树，"
  echo "要么删掉这个文件（参考 docs/CHANGELOG.md『删掉从不运行的测试文件』）。"
  exit 1
fi

echo "✅ Rust 模块树检查通过：backend/src 下没有孤儿 .rs 文件"
exit 0
