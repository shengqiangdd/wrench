use regex::Regex;

/// Validate an SSH host address.
/// Accepts IP address or hostname.
pub fn validate_host(host: &str) -> bool {
    if host.is_empty() || host.len() > 255 {
        return false;
    }

    // IPv4
    let ipv4_re = Regex::new(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$").unwrap();
    if ipv4_re.is_match(host) {
        let parts: Vec<&str> = host.split('.').collect();
        return parts.iter().all(|p| {
            p.parse::<u8>().is_ok()
        });
    }

    // Hostname (simple check)
    let hostname_re = Regex::new(r"^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*$").unwrap();
    hostname_re.is_match(host)
}

/// Validate port number.
pub fn validate_port(port: u16) -> bool {
    port > 0 // u16 max is already 65535, no need to check upper bound
}

/// Validate username.
pub fn validate_username(username: &str) -> bool {
    if username.is_empty() || username.len() > 64 {
        return false;
    }
    // Username must start with a letter and only contain safe characters
    let re = Regex::new(r"^[a-zA-Z_][a-zA-Z0-9_-]*$").unwrap();
    re.is_match(username)
}

/// Validate connection parameters.
pub fn validate_connection_params(
    host: &str,
    port: u16,
    username: &str,
    _password: Option<&str>,
    _private_key: Option<&str>,
) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();

    if !validate_host(host) {
        errors.push(format!("Invalid host: {}", host));
    }
    if !validate_port(port) {
        errors.push(format!("Invalid port: {}", port));
    }
    if !validate_username(username) {
        errors.push(format!("Invalid username: {}", username));
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Detect command injection attempts.
pub fn detect_injection(input: &str) -> bool {
    let dangerous = [
        ";",
        "`",
        "$(",
        "|",
        "&&",
        "||",
        ">",
        "<",
        "${",
        "\n",
        "\r",
    ];
    dangerous.iter().any(|c| input.contains(c))
}

/// Escape a shell argument to prevent injection.
pub fn escape_shell_arg(arg: &str) -> String {
    // Single-quote shell argument with escaping
    format!("'{}'", arg.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_ip() {
        assert!(validate_host("192.168.1.1"));
        assert!(validate_host("10.0.0.1"));
    }

    #[test]
    fn test_invalid_ip() {
        assert!(!validate_host("999.999.999.999"));
        assert!(!validate_host(""));
    }

    #[test]
    fn test_valid_hostname() {
        assert!(validate_host("example.com"));
        assert!(validate_host("my-server-01.local"));
    }

    #[test]
    fn test_detect_injection() {
        assert!(detect_injection("; rm -rf /"));
        assert!(detect_injection("$(cat /etc/passwd)"));
        assert!(!detect_injection("ls -la"));
    }

    #[test]
    fn test_port_validation() {
        assert!(validate_port(22));
        assert!(validate_port(65535));
        assert!(!validate_port(0));
    }
}
