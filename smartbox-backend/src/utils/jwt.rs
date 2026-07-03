use axum::http::StatusCode;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, TokenData, Validation};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Default token lifetime: 24 hours
pub const DEFAULT_JWT_EXPIRY_SECS: u64 = 86400;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub iat: u64,
    pub exp: u64,
    pub scope: String,
}

impl Claims {
    pub fn new(subject: String, scope: impl Into<String>, expires_in: u64) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("Time went backwards")
            .as_secs();
        Self {
            sub: subject,
            iat: now,
            exp: now + expires_in,
            scope: scope.into(),
        }
    }
}

pub struct JwtService {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
    validation: Validation,
}

impl JwtService {
    pub fn from_secret(secret: &str) -> anyhow::Result<Self> {
        Ok(Self {
            encoding_key: EncodingKey::from_secret(secret.as_bytes()),
            decoding_key: DecodingKey::from_secret(secret.as_bytes()),
            validation: Validation::new(Algorithm::HS256),
        })
    }

    pub fn sign(&self, claims: &Claims) -> Result<String, StatusCode> {
        jsonwebtoken::encode(&Header::default(), claims, &self.encoding_key)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    }

    pub fn verify(&self, token: &str) -> Result<TokenData<Claims>, StatusCode> {
        jsonwebtoken::decode::<Claims>(token, &self.decoding_key, &self.validation)
            .map_err(|_| StatusCode::UNAUTHORIZED)
    }
}
