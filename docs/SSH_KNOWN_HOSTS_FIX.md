# SSH Host Key Verification Fix (P0 Security Vulnerability)

## Problem
The `check_server_key()` function in `backend/src/ssh/pool.rs` unconditionally returned `Ok(true)`, accepting any host key without verification. This created a critical MITM (Man-in-the-Middle) vulnerability where attackers could intercept SSH connections.

## Solution
Implemented a known_hosts verification system that:
1. Stores trusted host keys in `~/.wrench/known_hosts` (or configurable path)
2. Verifies host keys on each connection
3. Supports strict mode (production) and auto-accept mode (development)
4. Maintains backward compatibility with existing connections

## Files Modified

### 1. `backend/src/ssh/known_hosts.rs` (NEW)
Complete known_hosts implementation with:
- `KnownHosts` struct with path and strict_mode configuration
- `fingerprint()` - Get SHA256 fingerprint of public keys
- `host_key()` - Format host:port identifier
- `is_trusted()` - Check if a host key is in the trusted store
- `trust()` - Add a host key to the trusted store
- `remove()` - Remove a host key from the trusted store
- `verify()` - Verify and handle trust based on mode
- `list()` - Get all trusted host keys
- Comprehensive unit tests

### 2. `backend/src/ssh/pool.rs`
Updated `SshHandler` to use known_hosts verification:
```rust
pub struct SshHandler {
    known_hosts: KnownHosts,
    host: String,
    port: u16,
}

impl client::Handler for SshHandler {
    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Use known_hosts verification instead of unconditional trust
        match self.known_hosts.verify(&self.host, self.port, server_public_key) {
            Ok(true) => Ok(true),
            Ok(false) => Err(russh::Error::NoAuthMethods),
            Err(e) => Err(russh::Error::NoAuthMethods),
        }
    }
}
```

Updated `SshSession` with new parameters:
```rust
pub fn new(
    connection_id: String,
    host: String,
    port: u16,
    username: String,
    known_hosts_path: Option<PathBuf>,
    strict_mode: bool,
) -> Self
```

Updated `connect_password()` and `connect_key()` methods to accept known_hosts parameters.

### 3. `backend/src/ssh/client.rs`
Added new fields to `ConnectRequest`:
```rust
pub struct ConnectRequest {
    // ... existing fields ...
    /// Optional path to known_hosts file for host key verification
    pub known_hosts_path: Option<String>,
    /// If true, reject unknown hosts; if false, auto-accept with warning
    pub strict_mode: Option<bool>,
}
```

### 4. `backend/src/ssh/mod.rs`
Added public export for `KnownHosts`:
```rust
pub use known_hosts::KnownHosts;
```

### 5. `backend/src/api/ssh.rs`
Updated `connect_ssh()` and `ensure_connection()` to pass known_hosts parameters.

### 6. `backend/src/websocket/terminal.rs`
Updated terminal connection handling to extract and pass known_hosts parameters from WebSocket messages.

### 7. `backend/Cargo.toml`
Added dependencies:
```toml
dirs = "5"  # For home directory detection

[dev-dependencies]
tempfile = "3"  # For testing
```

## Configuration

### Known Hosts File Format
```
# Comments start with #
192.168.1.1:22 SHA256:abc123def456...
10.0.0.1:2222 SHA256:xyz789uvw012...
```

### Default Path
`~/.wrench/known_hosts`

### Modes

#### Strict Mode (Production)
- Rejects unknown host keys
- Requires explicit trust via `known_hosts` file
- Recommended for production environments

#### Auto-Accept Mode (Development)
- Automatically trusts new host keys with warning
- Logs the fingerprint for manual verification
- Suitable for development/testing environments

## Usage Examples

### API Request
```json
{
  "host": "192.168.1.1",
  "port": 22,
  "username": "admin",
  "password": "secret",
  "knownHostsPath": "/custom/path/known_hosts",
  "strictMode": true
}
```

### WebSocket Message
```json
{
  "type": "connect",
  "host": "192.168.1.1",
  "port": 22,
  "username": "admin",
  "password": "secret",
  "knownHostsPath": "/custom/path/known_hosts",
  "strictMode": false
}
```

## Security Considerations

1. **MITM Prevention**: Host keys are verified before authentication
2. **Key Rotation**: Support for updating trusted keys when hosts change
3. **Audit Logging**: All trust operations are logged
4. **Backward Compatibility**: Existing connections continue to work
5. **File Permissions**: Ensure `known_hosts` file has appropriate permissions (0600)

## Testing

Run unit tests:
```bash
cargo test -p wrench-backend known_hosts
```

## Migration

1. Existing connections will auto-accept new host keys (if strict_mode=false)
2. For production, configure strict_mode=true and manually trust known hosts
3. No changes required for existing API clients (optional parameters)

## Monitoring

Monitor logs for:
- `Trusted host key:` - New host key accepted
- `Host key verified:` - Existing host key verified
- `Host key verification failed:` - MITM attempt detected
- `Auto-accepting new host key:` - New key auto-trusted (development mode)