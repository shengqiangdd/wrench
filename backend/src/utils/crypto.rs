use aes_gcm::{
    Aes256Gcm,
    aead::{Aead, KeyInit},
};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use pbkdf2::pbkdf2_hmac;
use rand::TryRng;
use rand::rngs::SysRng;
use sha2::Sha256;

// ── 门户口令哈希（PBKDF2-HMAC-SHA256）────────────────────────────────────────

/// 门户口令哈希迭代次数（OWASP 对 PBKDF2-HMAC-SHA256 的建议量级）。
///
/// 只在登录/设置口令时计算，不在请求热路径上，因此可以取较大值：
/// 换来的是即使数据库被拖走、口令哈希也极难离线爆破。
pub const DOOR_ITERATIONS: u32 = 600_000;

/// 生成门户口令哈希，格式：`pbkdf2-sha256$<iterations>$<salt_b64>$<hash_b64>`。
///
/// 盐为 16 字节系统随机数；同一口令每次哈希结果不同。
pub fn hash_door_password(password: &str) -> String {
    use rand::TryRng;
    let mut rng = rand::rngs::SysRng;
    let mut salt = [0u8; 16];
    rng.try_fill_bytes(&mut salt).expect("system RNG unavailable");
    let key = derive_key(password, &salt, DOOR_ITERATIONS);
    format!(
        "pbkdf2-sha256${}${}${}",
        DOOR_ITERATIONS,
        BASE64.encode(salt),
        BASE64.encode(key)
    )
}

/// 校验口令与存储的 PBKDF2 哈希是否匹配（恒定时间比较摘要）。
///
/// 参数（迭代次数、盐）都从存储串里读，便于将来提升迭代次数而不影响旧记录。
pub fn verify_door_hash(password: &str, stored: &str) -> bool {
    let Some(rest) = stored.strip_prefix("pbkdf2-sha256$") else {
        return false;
    };
    let parts: Vec<&str> = rest.split('$').collect();
    if parts.len() != 3 {
        return false;
    }
    let Ok(iterations) = parts[0].parse::<u32>() else {
        return false;
    };
    let (Ok(salt), Ok(expected)) = (BASE64.decode(parts[1]), BASE64.decode(parts[2])) else {
        return false;
    };
    let key = derive_key(password, &salt, iterations);
    // 先比 SHA-256 摘要再比字节：长度固定，避免按字节短路泄露前缀
    use sha2::Digest;
    Sha256::digest(key) == Sha256::digest(&expected)
}

/// legacy 环境变量口令（`WRENCH_AUTH_PASSWORD`）派生出的令牌版本号。
///
/// 数据库托管口令时，改口令会显式把 `token_version` +1（见 `AppState::set_door_password_hash`）；
/// 而 legacy 部署的口令只存在于环境变量里，没有可自增的地方 ——
/// 于是用「口令指纹」当版本号：部署者改环境变量口令 → 指纹变 → 所有旧令牌自动失效。
pub fn env_password_version(password: &str) -> u32 {
    use sha2::Digest;
    let mut hasher = Sha256::new();
    hasher.update(b"wrench-door-token-version:v1:");
    hasher.update(password.as_bytes());
    let digest = hasher.finalize();
    u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]])
}

// ── Key Derivation ──────────────────────────────────────────────────────────

/// Derive a 256-bit key using PBKDF2-HMAC-SHA256 (100K iterations).
///
/// This replaces the insecure SHA-256-based KDF. The high iteration count
/// makes brute-force attacks computationally expensive even when the source
/// password (JWT_SECRET) has low entropy.
pub fn derive_key(password: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut key);
    key
}

/// Derive the v1 legacy key using plain SHA-256 (INSECURE — migration only).
///
/// Used to decrypt entries encrypted before the PBKDF2 migration so they can
/// be re-encrypted with the new v2 key. Never use this for new data.
pub fn derive_v1_legacy_key(password: &str) -> [u8; 32] {
    use sha2::Digest;
    let hash = Sha256::digest(password.as_bytes());
    let mut key = [0u8; 32];
    key.copy_from_slice(&hash);
    key
}

// ── Password Verification ───────────────────────────────────────────────────

/// 恒定时间比较两个字节串（长度不同直接判否，本函数只用于等长摘要）。
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// 校验明文口令是否与配置的口令一致。
///
/// 先做 SHA-256 摘要（定长 32 字节），再恒定时间比较，
/// 避免按字节短路比较泄露前缀信息、也避免直接持有明文比较分支。
pub fn verify_password(input: &str, expected: &str) -> bool {
    use sha2::{Digest, Sha256};
    if expected.is_empty() {
        return false;
    }
    let a = Sha256::digest(input.as_bytes());
    let b = Sha256::digest(expected.as_bytes());
    constant_time_eq(&a, &b)
}

// ── AES-256-GCM Encryption ─────────────────────────────────────────────────

/// Encrypt sensitive data (SSH passwords, private keys) using AES-256-GCM.
///
/// Returns base64-encoded ciphertext with nonce prepended.
pub fn encrypt(plaintext: &str, key: &[u8; 32]) -> Result<String, String> {
    let key = aes_gcm::Key::<Aes256Gcm>::try_from(key.as_slice()).map_err(|_| "Invalid key length")?;
    let cipher = Aes256Gcm::new(&key);

    // Generate random 12-byte nonce
    let mut nonce_bytes = [0u8; 12];
    SysRng
        .try_fill_bytes(&mut nonce_bytes)
        .map_err(|e| format!("Failed to generate nonce: {:?}", e))?;
    let nonce = aes_gcm::Nonce::try_from(nonce_bytes.as_slice()).map_err(|_| "Invalid nonce length")?;

    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {:?}", e))?;

    // Prepend nonce to ciphertext
    let mut combined = Vec::new();
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(BASE64.encode(&combined))
}

/// Decrypt data that was encrypted with `encrypt`.
pub fn decrypt(encrypted: &str, key: &[u8; 32]) -> Result<String, String> {
    let combined = BASE64
        .decode(encrypted)
        .map_err(|e| format!("Base64 decode failed: {:?}", e))?;

    if combined.len() < 12 {
        return Err("Invalid ciphertext: too short".into());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = aes_gcm::Nonce::try_from(nonce_bytes).map_err(|_| "Invalid nonce length")?;
    let key = aes_gcm::Key::<Aes256Gcm>::try_from(key.as_slice()).map_err(|_| "Invalid key length")?;

    let cipher = Aes256Gcm::new(&key);
    let plaintext = cipher
        .decrypt(&nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {:?}", e))?;

    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 decode failed: {:?}", e))
}

/// Decrypt data encrypted with the legacy SHA-256 KDF (v1 format).
///
/// This function exists solely for migration — it replicates the old
/// `Sha256::digest(secret)` key derivation to read entries that were
/// created before the PBKDF2 migration.
pub fn decrypt_legacy(encrypted: &str, password: &str) -> Result<String, String> {
    let key = derive_v1_legacy_key(password);
    decrypt(encrypted, &key)
}

/// Generate a random 256-bit encryption key.
pub fn generate_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    SysRng.try_fill_bytes(&mut key).expect("Failed to generate random key");
    key
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = generate_key();
        let original = "my_secret_password_123!";
        let encrypted = encrypt(original, &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();
        assert_eq!(original, decrypted);
    }

    #[test]
    fn test_different_keys_fail() {
        let key1 = generate_key();
        let key2 = generate_key();
        let original = "secret";
        let encrypted = encrypt(original, &key1).unwrap();
        let result = decrypt(&encrypted, &key2);
        assert!(result.is_err());
    }

    // ── PBKDF2 KDF tests ──────────────────────────────────────────────

    #[test]
    fn test_derive_key_deterministic() {
        // Same password + salt + iterations → same key
        let key1 = derive_key("test-secret", b"test-salt", 1_000);
        let key2 = derive_key("test-secret", b"test-salt", 1_000);
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_derive_key_different_passwords() {
        let key1 = derive_key("password-a", b"salt", 1_000);
        let key2 = derive_key("password-b", b"salt", 1_000);
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_derive_key_different_salts() {
        let key1 = derive_key("password", b"salt-1", 1_000);
        let key2 = derive_key("password", b"salt-2", 1_000);
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_derive_key_production_params() {
        // Verify the production 100K iteration path works
        let key = derive_key("my-jwt-secret", b"wrench-vault-key-salt", 100_000);
        assert_eq!(key.len(), 32);
        // Should not be all zeros
        assert_ne!(key, [0u8; 32]);
    }

    #[test]
    fn test_v1_legacy_key_matches_old_sha256() {
        // Verify derive_v1_legacy_key reproduces the old Sha256::digest behavior
        use sha2::Digest;
        let secret = "my-jwt-secret";
        let old_hash = Sha256::digest(secret.as_bytes());
        let legacy_key = derive_v1_legacy_key(secret);

        let mut expected = [0u8; 32];
        expected.copy_from_slice(&old_hash);
        assert_eq!(legacy_key, expected);
    }

    #[test]
    fn test_encrypt_with_derived_key_roundtrip() {
        // End-to-end: derive key → encrypt → decrypt
        let password = "my-jwt-secret";
        let salt = b"wrench-vault-key-salt";
        let key = derive_key(password, salt, 1_000); // low iterations for test speed
        let plaintext = "super-secret-api-key-12345";
        let encrypted = encrypt(plaintext, &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();
        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn test_decrypt_legacy_with_sha256_key() {
        // Simulate: encrypt with legacy SHA-256 key, then decrypt with decrypt_legacy
        let secret = "test-legacy-secret";
        let legacy_key = derive_v1_legacy_key(secret);
        let plaintext = "legacy-encrypted-value";
        let encrypted = encrypt(plaintext, &legacy_key).unwrap();

        // decrypt_legacy should recover the plaintext from the SHA-256 derived key
        let decrypted = decrypt_legacy(&encrypted, secret).unwrap();
        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn test_v1_key_cannot_decrypt_v2_data() {
        // Verify that the old key fails to decrypt data encrypted with the new key
        let secret = "test-secret";
        let v1_key = derive_v1_legacy_key(secret);
        let v2_key = derive_key(secret, b"wrench-vault-key-salt", 1_000);
        let plaintext = "some-data";

        let encrypted_v2 = encrypt(plaintext, &v2_key).unwrap();
        let result = decrypt(&encrypted_v2, &v1_key);
        assert!(result.is_err(), "v1 key should NOT decrypt v2 data");
    }

    #[test]
    fn test_derive_key_empty_password() {
        // Edge case: empty password should still produce a valid key
        let key = derive_key("", b"salt", 1_000);
        assert_ne!(key, [0u8; 32]);
    }

    #[test]
    fn test_derive_key_unicode_password() {
        let key = derive_key("密码-🔑-secret", b"unicode-salt", 1_000);
        assert_ne!(key, [0u8; 32]);
    }

    #[test]
    fn test_verify_password_exact_match() {
        assert!(verify_password("s3cret-pw", "s3cret-pw"));
    }

    #[test]
    fn test_verify_password_rejects_wrong_and_prefix() {
        assert!(!verify_password("s3cret", "s3cret-pw"));
        assert!(!verify_password("s3cret-pw ", "s3cret-pw"));
        assert!(!verify_password("", "s3cret-pw"));
        assert!(!verify_password("S3CRET-PW", "s3cret-pw"));
    }

    #[test]
    fn test_verify_password_empty_expected_always_fails() {
        // 未配置口令时必须拒绝任何输入（fail-closed）
        assert!(!verify_password("", ""));
        assert!(!verify_password("anything", ""));
    }

    #[test]
    fn test_constant_time_eq() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }

    #[test]
    fn test_verify_password_unicode() {
        assert!(verify_password("密码-🔑", "密码-🔑"));
        assert!(!verify_password("密码", "密码-🔑"));
    }
}
