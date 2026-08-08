/**
 * Git 速查手册插件
 * 
 * 分类速查表、交互式命令生成、分支管理、冲突解决
 */
(function() {
  const GitCheatsheet = {
    id: 'git-cheatsheet',
    name: 'Git 速查手册',

    categories: {
      '🚀 基础操作': [
        ['git init', '初始化仓库'],
        ['git clone <url>', '克隆远程仓库'],
        ['git add .', '暂存所有文件'],
        ['git add <file>', '暂存指定文件'],
        ['git commit -m "msg"', '提交暂存区'],
        ['git status', '查看工作区状态'],
        ['git diff', '查看未暂存的更改'],
        ['git diff --cached', '查看已暂存的更改'],
        ['git log --oneline --graph', '图形化查看提交历史'],
        ['git log -5', '查看最近 5 条提交'],
        ['git show <commit>', '查看某次提交详情'],
      ],
      '🌿 分支管理': [
        ['git branch', '列出本地分支'],
        ['git branch -a', '列出所有分支（含远程）'],
        ['git branch <name>', '创建新分支'],
        ['git checkout <branch>', '切换分支'],
        ['git checkout -b <name>', '创建并切换分支'],
        ['git switch <name>', '切换分支（推荐）'],
        ['git switch -c <name>', '创建并切换（推荐）'],
        ['git merge <branch>', '合并指定分支到当前'],
        ['git branch -d <name>', '删除已合并的分支'],
        ['git branch -D <name>', '强制删除分支'],
        ['git branch -m <old> <new>', '重命名分支'],
      ],
      '🔄 远程操作': [
        ['git remote -v', '查看远程仓库'],
        ['git remote add origin <url>', '添加远程仓库'],
        ['git push origin <branch>', '推送到远程'],
        ['git push -u origin <branch>', '推送并设置上游跟踪'],
        ['git push --force', '强制推送（危险！）'],
        ['git pull', '拉取并合并远程更新'],
        ['git pull --rebase', '拉取并变基'],
        ['git fetch', '获取远程更新（不合并）'],
        ['git fetch --prune', '清理已删除的远程分支'],
      ],
      '⏪ 撤销与回退': [
        ['git reset HEAD <file>', '取消暂存'],
        ['git restore <file>', '放弃工作区更改'],
        ['git restore --staged <file>', '取消暂存（保留更改）'],
        ['git reset --soft HEAD~1', '撤销提交，保留更改在暂存区'],
        ['git reset --mixed HEAD~1', '撤销提交，保留更改在工作区'],
        ['git reset --hard HEAD~1', '彻底回退（丢失更改！）'],
        ['git revert <commit>', '创建反向提交（安全回退）'],
        ['git stash', '暂存当前工作'],
        ['git stash pop', '恢复最近一次 stash'],
        ['git stash list', '列出所有 stash'],
      ],
      '🏷️ 标签': [
        ['git tag <name>', '创建轻量标签'],
        ['git tag -a <name> -m "msg"', '创建注释标签'],
        ['git tag -a <name> <commit>', '给历史提交打标签'],
        ['git push origin <tag>', '推送标签到远程'],
        ['git push origin --tags', '推送所有标签'],
        ['git tag -d <name>', '删除本地标签'],
        ['git push origin --delete <tag>', '删除远程标签'],
      ],
      '🔧 实用技巧': [
        ['git blame <file>', '查看文件每一行的修改者'],
        ['git log --author="name"', '按作者筛选提交'],
        ['git log --grep="keyword"', '按关键词筛选提交'],
        ['git log --since="2 weeks ago"', '按时间筛选提交'],
        ['git shortlog -sn', '统计每位贡献者的提交数'],
        ['git clean -fd', '删除未跟踪的文件和目录'],
        ['git gc', '压缩仓库，清理无用对象'],
        ['git reflog', '查看 HEAD 移动历史（救命稻草！）'],
        ['git cherry-pick <commit>', '拣选某次提交到当前分支'],
        ['git rebase -i HEAD~5', '交互式变基最近 5 次提交'],
        ['git bisect start', '二分查找引入 bug 的提交'],
      ],
      '🚨 冲突解决': [
        ['<<<<<<< HEAD', '冲突开始标记（你的更改）'],
        ['=======', '分隔符'],
        ['>>>>>>> branch', '冲突结束标记（对方的更改）'],
        ['解决后: git add .', '标记冲突已解决'],
        ['解决后: git commit', '完成合并提交'],
        ['git merge --abort', '放弃当前合并'],
        ['git rebase --abort', '放弃当前变基'],
      ],
    },

    init() {
      if (typeof wrench !== 'undefined' && wrench.panels) {
        wrench.panels.register('git-panel', {
          title: 'Git 速查手册',
          icon: 'git-branch',
          render: (container) => this.renderPanel(container)
        });
      }
    },

    renderPanel(container) {
      const sectionsHtml = Object.entries(this.categories).map(([title, cmds]) => {
        const rows = cmds.map(([cmd, desc]) => `
          <div class="git-row" onclick="GitCheatsheet.copyCmd('${cmd.replace(/'/g, "\\'")}')">
            <code class="git-cmd">${this.escapeHtml(cmd)}</code>
            <span class="git-desc">${desc}</span>
            <span class="git-copy-hint">📋</span>
          </div>
        `).join('');
        return `<div class="git-section"><h4>${title}</h4>${rows}</div>`;
      }).join('');

      container.innerHTML = `
        <div class="plugin-git-cheatsheet">
          <div class="git-search">
            <input type="text" id="git-search" placeholder="🔍 搜索命令..." />
          </div>
          <div class="git-body" id="git-body">${sectionsHtml}</div>
          <div class="git-copied" id="git-copied">✅ 已复制到剪贴板</div>
          <style>
            .plugin-git-cheatsheet { padding: 16px; }
            .git-search input {
              width: 100%; padding: 8px 12px; background: #1a1d23; border: 1px solid #3a3f47;
              border-radius: 6px; color: #e0e0e0; font-size: 0.9em; box-sizing: border-box;
            }
            .git-search input:focus { border-color: #4a9eff; outline: none; }
            .git-section h4 { margin: 16px 0 6px; font-size: 1em; color: #e0e0e0; }
            .git-row {
              display: flex; align-items: center; padding: 5px 8px; border-radius: 4px;
              cursor: pointer; transition: background 0.15s; position: relative;
            }
            .git-row:hover { background: #4a9eff11; }
            .git-row:hover .git-copy-hint { opacity: 1; }
            .git-cmd { color: #4a9eff; font-family: monospace; font-size: 0.85em; min-width: 280px; flex-shrink: 0; }
            .git-desc { color: #888; font-size: 0.82em; margin-left: 12px; }
            .git-copy-hint { position: absolute; right: 8px; opacity: 0; font-size: 0.8em; transition: opacity 0.15s; }
            .git-copied {
              position: fixed; top: 20px; right: 20px; background: #4a9eff; color: #fff;
              padding: 6px 16px; border-radius: 6px; opacity: 0; transition: opacity 0.3s;
              pointer-events: none; z-index: 100; font-size: 0.85em;
            }
            .git-copied.show { opacity: 1; }
          </style>
        </div>
      `;

      // 搜索过滤
      document.getElementById('git-search').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        container.querySelectorAll('.git-section').forEach(sec => {
          let hasVisible = false;
          sec.querySelectorAll('.git-row').forEach(row => {
            const text = row.textContent.toLowerCase();
            const match = text.includes(q);
            row.style.display = match ? '' : 'none';
            if (match) hasVisible = true;
          });
          sec.style.display = hasVisible ? '' : 'none';
        });
      });
    },

    escapeHtml(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    copyCmd(cmd) {
      navigator.clipboard.writeText(cmd);
      const toast = document.getElementById('git-copied');
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 1200);
    }
  };

  if (typeof window !== 'undefined') window.GitCheatsheet = GitCheatsheet;
})();
