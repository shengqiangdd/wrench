use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use pbkdf2::pbkdf2_hmac;
use rand::rngs::SysRng;
use rand::TryRng;
use sha2::Sha256;

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

// ── AES-256-GCM Encryption ─────────────────────────────────────────────────

/// Encrypt sensitive data (SSH passwords, private keys) using AES-256-GCM.
///
/// Returns base64-encoded ciphertext with nonce prepended.
pub fn encrypt(plaintext: &str, key: &[u8; 32]) -> Result<String, String> {
    let key = aes_gcm::Key::<Aes256Gcm>::try_from(key.as_slice())
        .map_err(|_| "Invalid key length")?;
    let cipher = Aes256Gcm::new(&key);

    // Generate random 12-byte nonce
    let mut nonce_bytes = [0u8; 12];
    SysRng.try_fill_bytes(&mut nonce_bytes)
        .map_err(|e| format!("Failed to generate nonce: {:?}", e))?;
    let nonce = aes_gcm::Nonce::try_from(nonce_bytes.as_slice())
        .map_err(|_| "Invalid nonce length")?;

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
    let nonce = aes_gcm::Nonce::try_from(nonce_bytes)
        .map_err(|_| "Invalid nonce length")?;
    let key = aes_gcm::Key::<Aes256Gcm>::try_from(key.as_slice())
        .map_err(|_| "Invalid key length")?;

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
}
