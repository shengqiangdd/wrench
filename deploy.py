"""
Wrench 部署脚本 — 优化版
用法:
  python deploy.py              # 正常部署（利用缓存，增量构建）
  python deploy.py --no-cache   # 强制全量重建（仅依赖变化时需要）
  python deploy.py --check      # 仅检查状态，不部署
"""
import paramiko, sys, io, time, os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

REMOTE_HOST = '192.168.2.9'
REMOTE_USER = 'admin'
REMOTE_PASS = 'csq0216'
REMOTE_DIR = '/vol1/1000/docker/qwenpaw/data/working/workspaces/default/wrench'

no_cache = '--no-cache' in sys.argv
check_only = '--check' in sys.argv

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(REMOTE_HOST, 22, REMOTE_USER, REMOTE_PASS, timeout=10)

def run(cmd, label=None):
    """用 root 权限执行命令（解决 .git 权限问题）"""
    if label:
        print(f'\n=== {label} ===')
    full_cmd = f'echo "{REMOTE_PASS}" | sudo -S -u root bash -c "{cmd}"'
    stdin, stdout, stderr = ssh.exec_command(full_cmd, timeout=300)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out:
        print(out)
    if err and 'password' not in err.lower():
        print(err, file=sys.stderr)
    return out

# 1. 拉取最新代码
run(f'cd {REMOTE_DIR} && git fetch origin && git reset --hard origin/main', 'git pull')

# 2. 检查状态
if check_only:
    run(f'cd {REMOTE_DIR} && docker compose ps', 'status')
    ssh.close()
    sys.exit(0)

# 3. 构建并部署
build_flag = '--no-cache' if no_cache else ''
run(
    f'cd {REMOTE_DIR} && docker compose down && docker compose build {build_flag} && docker compose up -d',
    f'build & deploy ({\"no-cache\" if no_cache else \"cached\"})'
)

# 4. 等待健康检查
time.sleep(5)
out = run(f'cd {REMOTE_DIR} && docker compose ps && docker compose logs --tail=5', 'status')

if 'healthy' in out:
    print('\n✅ 部署成功，容器 healthy')
else:
    print('\n⚠️ 容器可能未就绪，请检查日志')

ssh.close()
