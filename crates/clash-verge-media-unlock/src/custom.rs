use std::time::Duration;

use regex::Regex;
use reqwest::{Client, Url, header};
use serde::{Deserialize, Serialize};

use super::utils::get_local_date_string;

const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CustomUnlockTest {
    pub name: String,
    pub url: String,
    pub expected_status: u16,
    pub body_contains: String,
    pub region_pattern: String,
    pub host_header: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CustomUnlockResult {
    pub name: String,
    pub status: String,
    pub region: Option<String>,
    pub check_time: Option<String>,
    pub http_status: Option<u16>,
    pub error: Option<String>,
}

impl CustomUnlockResult {
    fn new(name: &str, status: &str, http_status: Option<u16>, region: Option<String>, error: Option<&str>) -> Self {
        Self {
            name: name.to_owned(),
            status: status.to_owned(),
            region,
            check_time: Some(get_local_date_string()),
            http_status,
            error: error.map(str::to_owned),
        }
    }
}

pub async fn check_custom_unlock(client: &Client, test: &CustomUnlockTest) -> CustomUnlockResult {
    tokio::time::timeout(Duration::from_secs(15), run_custom_unlock(client, test))
        .await
        .unwrap_or_else(|_| CustomUnlockResult::new(&test.name, "Failed", None, None, Some("timeout")))
}

async fn run_custom_unlock(client: &Client, test: &CustomUnlockTest) -> CustomUnlockResult {
    let failure = |error| CustomUnlockResult::new(&test.name, "Failed", None, None, Some(error));
    let Ok(url) = Url::parse(&test.url) else {
        return failure("invalidUrl");
    };
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || !(100..=599).contains(&test.expected_status)
    {
        return failure("invalidUrlOrStatus");
    }
    let pattern = if test.region_pattern.trim().is_empty() {
        None
    } else {
        match Regex::new(&test.region_pattern) {
            Ok(pattern) => Some(pattern),
            Err(_) => return failure("invalidPattern"),
        }
    };

    let mut request = client.get(url);
    if !test.host_header.trim().is_empty() {
        let Ok(host) = header::HeaderValue::from_str(test.host_header.trim()) else {
            return failure("invalidHost");
        };
        request = request.header(header::HOST, host);
    }
    let Ok(mut response) = request.send().await else {
        return failure("requestFailed");
    };
    let http_status = response.status().as_u16();
    let mut bytes = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if bytes.len() + chunk.len() > MAX_BODY_BYTES {
                    return CustomUnlockResult::new(
                        &test.name,
                        "Failed",
                        Some(http_status),
                        None,
                        Some("bodyTooLarge"),
                    );
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(_) => {
                return CustomUnlockResult::new(&test.name, "Failed", Some(http_status), None, Some("responseFailed"));
            }
        }
    }

    let body = String::from_utf8_lossy(&bytes);
    let region = pattern.as_ref().and_then(|pattern| {
        pattern
            .captures(&body)
            .and_then(|captures| captures.get(1).or_else(|| captures.get(0)))
            .map(|value| value.as_str().trim().to_owned())
            .filter(|value| !value.is_empty())
    });
    let matched = http_status == test.expected_status
        && (test.body_contains.is_empty() || body.contains(&test.body_contains))
        && (pattern.is_none() || region.is_some());
    CustomUnlockResult::new(
        &test.name,
        if matched { "Matched" } else { "Mismatch" },
        Some(http_status),
        region,
        None,
    )
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read as _, Write as _},
        net::TcpListener,
        thread,
    };

    use super::*;

    fn server(response: &'static str) -> std::io::Result<String> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let address = listener.local_addr()?;
        thread::spawn(move || -> std::io::Result<()> {
            let (mut stream, _) = listener.accept()?;
            let mut buffer = [0; 4096];
            let _ = stream.read(&mut buffer);
            stream.write_all(response.as_bytes())
        });
        Ok(format!("http://{address}/"))
    }

    fn test_config(url: String) -> CustomUnlockTest {
        CustomUnlockTest {
            name: "test".into(),
            url,
            expected_status: 200,
            body_contains: "Country version:".into(),
            region_pattern: r"Country version:</a>\s*([^<]+)".into(),
            host_header: String::new(),
        }
    }

    #[tokio::test]
    async fn matches_status_content_and_extracts_region() -> Result<(), Box<dyn std::error::Error>> {
        let url = server("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nCountry version:</a> United States</p>")?;
        let client = Client::builder().no_proxy().build()?;
        let result = check_custom_unlock(&client, &test_config(url)).await;
        assert_eq!(result.status, "Matched");
        assert_eq!(result.http_status, Some(200));
        assert_eq!(result.region.as_deref(), Some("United States"));
        Ok(())
    }

    #[tokio::test]
    async fn mismatched_status_or_missing_region_is_not_reported_as_available() -> Result<(), Box<dyn std::error::Error>>
    {
        let client = Client::builder().no_proxy().build()?;
        let url =
            server("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\nCountry version:</a> United States</p>")?;
        let result = check_custom_unlock(&client, &test_config(url)).await;
        assert_eq!(result.status, "Mismatch");
        assert_eq!(result.http_status, Some(401));

        let url = server("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nUnexpected response")?;
        let result = check_custom_unlock(&client, &test_config(url)).await;
        assert_eq!(result.status, "Mismatch");
        assert_eq!(result.region, None);
        Ok(())
    }

    #[tokio::test]
    async fn invalid_region_pattern_fails_without_a_request() -> Result<(), Box<dyn std::error::Error>> {
        let client = Client::builder().no_proxy().build()?;
        let mut test = test_config("http://127.0.0.1:1/".into());
        test.region_pattern = "(".into();
        let result = check_custom_unlock(&client, &test).await;
        assert_eq!(result.status, "Failed");
        assert_eq!(result.error.as_deref(), Some("invalidPattern"));
        Ok(())
    }
}
