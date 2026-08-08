#!/usr/bin/env python3
"""Rebuild frontend inside Docker container."""

import paramiko
import sys

HOST = '192.168.2.9'
PORT = 22
USERNAME = 'admin'
PASSWORD = 'csq0216'

def main():
    print("[1/3] Connecting...")
    
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        ssh.connect(HOST, port=PORT, username=USERNAME, password=PASSWORD, timeout=15)
        print("  Connected!")
        
        # Find the wrench container
        print("\n[2/3] Finding wrench container...")
        stdin, stdout, stderr = ssh.exec_command(
            'docker ps --filter "name=wrench" --format "{{.Names}}"',
            timeout=10
        )
        container_name = stdout.read().decode().strip()
        if not container_name:
            print("  ERROR: No wrench container found!")
            sys.exit(1)
        print(f"  Container: {container_name}")
        
        # Check if npm is available inside container
        print("\n[3/3] Rebuilding frontend inside container...")
        stdin, stdout, stderr = ssh.exec_command(
            f'docker exec {container_name} which npm',
            timeout=10
        )
        npm_path = stdout.read().decode().strip()
        if npm_path:
            print(f"  npm found at: {npm_path}")
            
            # Rebuild frontend
            print("  Running npm install + vite build...")
            stdin, stdout, stderr = ssh.exec_command(
                f'docker exec {container_name} bash -c "cd /app/frontend && npm install && node node_modules/vite/bin/vite.js build"',
                timeout=180
            )
            output = stdout.read().decode()
            error = stderr.read().decode()
            
            if output.strip():
                lines = output.strip().split('\n')
                for line in lines[-10:]:
                    print(f"  {line}")
            
            if error.strip():
                # Filter out WARN lines
                error_lines = [l for l in error.strip().split('\n') if 'WARN' not in l]
                if error_lines:
                    print(f"  Errors: {' '.join(error_lines[-3:])}")
            
            # Restart container to pick up new frontend
            print("\n  Restarting container...")
            stdin, stdout, stderr = ssh.exec_command(
                f'docker restart {container_name}',
                timeout=30
            )
            restart_output = stdout.read().decode().strip()
            print(f"  Restarted: {restart_output}")
            
            # Health check
            import time
            time.sleep(3)
            stdin, stdout, stderr = ssh.exec_command(
                f'docker exec {container_name} curl -s -o /dev/null -w "%{{http_code}}" http://localhost:3001/',
                timeout=10
            )
            health = stdout.read().decode().strip()
            print(f"\n  HTTP status: {health}")
            
        else:
            print("  npm not found in container, trying alternative approach...")
            # Maybe the container uses a different path
            stdin, stdout, stderr = ssh.exec_command(
                f'docker exec {container_name} ls /app/frontend/node_modules/.bin/ 2>/dev/null | head -5',
                timeout=10
            )
            print(f"  Available binaries: {stdout.read().decode().strip()}")
        
        print("\n=== Done! ===")
        print("Open Edge browser: http://192.168.2.9:3001")
        
    except Exception as e:
        print(f"  Error: {e}")
        sys.exit(1)
    finally:
        ssh.close()

if __name__ == '__main__':
    main()
