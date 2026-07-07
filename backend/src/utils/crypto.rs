use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

/// Encrypt sensitive data (SSH passwords, private keys) using AES-256-GCM.
///
/// Returns base64-encoded ciphertext with nonce prepended.
pub fn encrypt(plaintext: &str, key: &[u8; 32]) -> Result<String, String> {
    let key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {:?}", e))?;

    // Prepend nonce to ciphertext
    let mut combined = Vec::new();
    combined.extend_from_slice(&nonce);
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
    let nonce = Nonce::from_slice(nonce_bytes);
    let key = Key::<Aes256Gcm>::from_slice(key);

    let cipher = Aes256Gcm::new(key);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {:?}", e))?;

    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 decode failed: {:?}", e))
}

/// Generate a random 256-bit encryption key.
pub fn generate_key() -> [u8; 32] {
    use rand::RngCore;
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    key
}

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
}
