#!/usr/bin/env python3
"""Deploy terminal Backspace/Delete fix to Wrench server via SSH."""

import paramiko
import os
import sys

# Server config
HOST = '192.168.2.9'
PORT = 22
USERNAME = 'admin'
PASSWORD = 'csq0216'

# Remote paths
REMOTE_WRENCH_DIR = '/vol1/1000/docker/qwenpaw/data/working/workspaces/default/wrench'
REMOTE_TERMINAL_FILE = f'{REMOTE_WRENCH_DIR}/frontend/src/modules/ssh/Terminal.tsx'

# Local file to upload
LOCAL_TERMINAL_FILE = os.path.join(os.path.dirname(__file__), 'frontend', 'src', 'modules', 'ssh', 'Terminal.tsx')

def main():
    print(f"[1/5] Connecting to {HOST}:{PORT} as {USERNAME}...")
    
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        ssh.connect(HOST, port=PORT, username=USERNAME, password=PASSWORD, timeout=15)
        print("  Connected!")
        
        # Step 1: Upload the fixed Terminal.tsx
        print(f"\n[2/5] Uploading fixed Terminal.tsx...")
        sftp = ssh.open_sftp()
        sftp.put(LOCAL_TERMINAL_FILE, REMOTE_TERMINAL_FILE)
        sftp.close()
        print("  File uploaded!")
        
        # Step 2: Git commit on server
        print("\n[3/5] Committing on server...")
        stdin, stdout, stderr = ssh.exec_command(
            f'cd {REMOTE_WRENCH_DIR} && '
            'git add frontend/src/modules/ssh/Terminal.tsx && '
            'git commit -m "fix(terminal): fix Backspace/Delete character overlap" || echo "Nothing to commit"',
            timeout=30
        )
        output = stdout.read().decode()
        error = stderr.read().decode()
        if output.strip():
            print(output.strip())
        if error.strip() and 'nothing to commit' not in error.lower():
            print(f"  stderr: {error.strip()}")
        
        # Step 3: Rebuild frontend
        print("\n[4/5] Rebuilding frontend...")
        stdin, stdout, stderr = ssh.exec_command(
            f'cd {REMOTE_WRENCH_DIR}/frontend && npm install && node node_modules/vite/bin/vite.js build',
            timeout=120
        )
        output = stdout.read().decode()
        error = stderr.read().decode()
        if output.strip():
            lines = output.strip().split('\n')
            for line in lines[-5:]:
                print(line)
        if error.strip() and 'WARN' not in error:
            print(f"  stderr: {error.strip()[-500:]}")
        
        # Step 4: Check if Docker is used for Wrench
        print("\n[5/5] Checking Docker status...")
        stdin, stdout, stderr = ssh.exec_command(
            'docker ps --filter "name=wrench" --format "{{.Names}} {{.Status}}"',
            timeout=10
        )
        docker_output = stdout.read().decode().strip()
        if docker_output:
            print(f"  Found containers: {docker_output}")
            
            # Restart the container
            print("  Restarting Wrench container...")
            stdin, stdout, stderr = ssh.exec_command(
                'docker restart $(docker ps --filter "name=wrench" -q)',
                timeout=30
            )
            restart_output = stdout.read().decode().strip()
            if restart_output:
                print(f"  Restarted: {restart_output}")
            print("  Container restarted!")
        else:
            # Maybe it's running as a process
            print("  No Docker container found, checking for running process...")
            stdin, stdout, stderr = ssh.exec_command(
                'ps aux | grep -i wrench | grep -v grep',
                timeout=10
            )
            proc_output = stdout.read().decode().strip()
            if proc_output:
                print(f"  Found process: {proc_output[:200]}")
                # Try to restart via systemctl or supervisor
                print("  Attempting to restart...")
                stdin, stdout, stderr = ssh.exec_command(
                    'sudo systemctl restart wrench 2>/dev/null || sudo supervisorctl restart wrench 2>/dev/null || echo "No systemd/supervisor service found"',
                    timeout=10
                )
                print(stdout.read().decode().strip())
            else:
                print("  No running Wrench process found")
        
        # Step 5: Health check
        print("\n[Health check]")
        stdin, stdout, stderr = ssh.exec_command(
            'curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/ 2>/dev/null || echo "not reachable"',
            timeout=10
        )
        health = stdout.read().decode().strip()
        print(f"  HTTP status: {health}")
        
        print("\n=== Deployment complete! ===")
        print("Open Edge browser and navigate to http://192.168.2.9:3001")
        
    except paramiko.AuthenticationException:
        print("  Authentication failed!")
        sys.exit(1)
    except paramiko.SSHException as e:
        print(f"  SSH error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"  Error: {e}")
        sys.exit(1)
    finally:
        ssh.close()

if __name__ == '__main__':
    main()
