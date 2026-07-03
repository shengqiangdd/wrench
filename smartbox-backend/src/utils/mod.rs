pub mod crypto;
pub mod jwt;
pub mod path;
pub mod validator;

/// Escape an argument for safe use in a shell command.
///
/// * If the arg is empty, returns `''`.
/// * If it contains only safe characters (alphanumeric + `/. _-:@=+~,%`), returns as-is.
/// * Otherwise wraps in single quotes with embedded single-quote handling (`'\''` trick).
pub fn escape_sh_arg(arg: &str) -> String {
    if arg.is_empty() {
        return "''".into();
    }
    if arg
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '/' | '.' | '_' | '-' | ':' | '@' | '=' | '+' | '~' | ',' | '%'))
    {
        return arg.to_string();
    }
    let escaped = arg.replace('\'', "'\\''");
    format!("'{}'", escaped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_escape_safe() {
        assert_eq!(escape_sh_arg("hello"), "hello");
        assert_eq!(escape_sh_arg("/var/log/nginx/access.log"), "/var/log/nginx/access.log");
        assert_eq!(escape_sh_arg("my_file-1.2.3.tar.gz"), "my_file-1.2.3.tar.gz");
        assert_eq!(escape_sh_arg("USER=root"), "USER=root");
        assert_eq!(escape_sh_arg("user@host"), "user@host");
        assert_eq!(escape_sh_arg("~/.ssh/id_rsa"), "~/.ssh/id_rsa");
        assert_eq!(escape_sh_arg("100%"), "100%");
    }

    #[test]
    fn test_escape_unsafe() {
        assert_eq!(escape_sh_arg("hello world"), "'hello world'");
        assert_eq!(escape_sh_arg("path; rm -rf /"), "'path; rm -rf /'");
        assert_eq!(escape_sh_arg("$(whoami)"), "'$(whoami)'");
        assert_eq!(escape_sh_arg("`pwd`"), "'`pwd`'");
        assert_eq!(escape_sh_arg("arg|other"), "'arg|other'");
        assert_eq!(escape_sh_arg("arg&other"), "'arg&other'");
        assert_eq!(escape_sh_arg("arg>out"), "'arg>out'");
        assert_eq!(escape_sh_arg("arg<in"), "'arg<in'");
    }

    #[test]
    fn test_escape_quote() {
        assert_eq!(escape_sh_arg("it's"), "'it'\\''s'");
        assert_eq!(escape_sh_arg("'hello'"), "''\\''hello'\\'''");
    }

    #[test]
    fn test_escape_empty() {
        assert_eq!(escape_sh_arg(""), "''");
    }

    #[test]
    fn test_escape_newline() {
        assert_eq!(escape_sh_arg("line1\nline2"), "'line1\nline2'");
    }

    #[test]
    fn test_escape_dollar() {
        // $ is not safe → should be quoted
        assert_eq!(escape_sh_arg("$VAR"), "'$VAR'");
        assert_eq!(escape_sh_arg("${PATH}"), "'${PATH}'");
    }
}

