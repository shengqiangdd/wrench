#!/usr/bin/env python3
"""Full Docker rebuild for Wrench terminal fix."""

import paramiko
import sys
import time

HOST = '192.168.2.9'
PORT = 22
USERNAME = 'admin'
PASSWORD = 'csq0216'
REMOTE_DIR = '/vol1/1000/docker/qwenpaw/data/working/workspaces/default/wrench'

def main():
    print("[1/5] Connecting...")
    
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        ssh.connect(HOST, port=PORT, username=USERNAME, password=PASSWORD, timeout=15)
        print("  Connected!")
        
        # Step 1: Add safe.directory for git
        print("\n[2/5] Configuring git safe.directory...")
        stdin, stdout, stderr = ssh.exec_command(
            f'git config --global --add safe.directory {REMOTE_DIR}',
            timeout=10
        )
        stdout.read()
        print("  Done!")
        
        # Step 2: Git add and commit
        print("\n[3/5] Committing changes...")
        stdin, stdout, stderr = ssh.exec_command(
            f'cd {REMOTE_DIR} && '
            'git add frontend/src/modules/ssh/Terminal.tsx && '
            'git diff --cached --stat',
            timeout=15
        )
        output = stdout.read().decode()
        if output.strip():
            print(output.strip())
        
        stdin, stdout, stderr = ssh.exec_command(
            f'cd {REMOTE_DIR} && git commit -m "fix(terminal): fix Backspace/Delete character overlap" || echo "Nothing to commit"',
            timeout=15
        )
        output = stdout.read().decode()
        print(f"  {output.strip()}")
        
        # Step 3: Docker rebuild (this will rebuild frontend too)
        print("\n[4/5] Docker rebuild (this may take 2-3 minutes)...")
        stdin, stdout, stderr = ssh.exec_command(
            f'cd {REMOTE_DIR} && docker compose build --no-cache 2>&1',
            timeout=600
        )
        output = stdout.read().decode()
        error = stderr.read().decode()
        
        # Show build progress
        if output.strip():
            lines = output.strip().split('\n')
            # Show last 15 lines
            for line in lines[-15:]:
                print(f"  {line}")
        
        if error.strip():
            error_lines = error.strip().split('\n')
            for line in error_lines[-5:]:
                print(f"  ERROR: {line}")
        
        # Step 4: Restart container
        print("\n[5/5] Restarting container...")
        stdin, stdout, stderr = ssh.exec_command(
            'docker compose -f /vol1/1000/docker/qwenpaw/data/working/workspaces/default/wrench/docker-compose.yml up -d',
            timeout=60
        )
        output = stdout.read().decode()
        if output.strip():
            print(f"  {output.strip()}")
        
        # Wait for container to start
        print("  Waiting for container to start...")
        time.sleep(5)
        
        # Health check
        stdin, stdout, stderr = ssh.exec_command(
            'curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/',
            timeout=10
        )
        health = stdout.read().decode().strip()
        print(f"\n  HTTP status: {health}")
        
        if health == '200':
            print("\n=== SUCCESS! ===")
            print("Open Edge browser: http://192.168.2.9:3001")
        else:
            print("\n=== WARNING: Health check failed ===")
            print("Check container logs: docker logs wrench")
        
    except Exception as e:
        print(f"  Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        ssh.close()

if __name__ == '__main__':
    main()
