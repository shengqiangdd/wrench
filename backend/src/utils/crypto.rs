use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::TryRngCore;

/// Encrypt sensitive data (SSH passwords, private keys) using AES-256-GCM.
///
/// Returns base64-encoded ciphertext with nonce prepended.
pub fn encrypt(plaintext: &str, key: &[u8; 32]) -> Result<String, String> {
    let key = aes_gcm::Key::<Aes256Gcm>::try_from(key.as_slice())
        .map_err(|_| "Invalid key length")?;
    let cipher = Aes256Gcm::new(&key);
    
    // Generate random 12-byte nonce
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.try_fill_bytes(&mut nonce_bytes)
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

/// Generate a random 256-bit encryption key.
pub fn generate_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    rand::rngs::OsRng.try_fill_bytes(&mut key).expect("Failed to generate random key");
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
