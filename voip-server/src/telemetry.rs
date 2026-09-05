// Moduł integracji Sentry dla aplikacji serwera VoIP (Nauczyciel)
use std::borrow::Cow;

/// Domyślny DSN Sentry.
/// Możesz wkleić tutaj bezpośrednio swój DSN (np. "https://xxx@yyy.ingest.sentry.io/zzz")
/// lub przekazywać go za pomocą zmiennej środowiskowej SENTRY_DSN podczas uruchamiania/budowania.
pub const DEFAULT_SENTRY_DSN: &str = "";

/// Inicjalizacja klienta Sentry.
/// Zwraca strażnika (Guard), który musi pozostać aktywny przez cały czas życia aplikacji.
pub fn init() -> Option<sentry::ClientInitGuard> {
    let dsn_str = std::env::var("SENTRY_DSN")
        .ok()
        .or_else(|| option_env!("SENTRY_DSN").map(|s| s.to_string()))
        .unwrap_or_else(|| DEFAULT_SENTRY_DSN.to_string());

    let clean_dsn = dsn_str.trim();
    if clean_dsn.is_empty() {
        return None;
    }

    let guard = sentry::init((
        clean_dsn,
        sentry::ClientOptions {
            release: sentry::release_name!(),
            environment: Some(if cfg!(debug_assertions) {
                Cow::Borrowed("development")
            } else {
                Cow::Borrowed("production")
            }),
            auto_session_tracking: true,
            traces_sample_rate: 1.0,
            ..Default::default()
        },
    ));

    sentry::configure_scope(|scope| {
        scope.set_tag("app_type", "server");
        scope.set_tag("app_name", "voip-server");
        scope.set_tag("os", std::env::consts::OS);
    });

    Some(guard)
}

/// Przechwytywanie błędu (np. z frontendu lub wewnętrznej logiki) i wysyłka do Sentry
pub fn capture_error(message: &str, stack: Option<&str>) {
    if sentry::Hub::current().client().is_some() {
        sentry::with_scope(
            |scope| {
                if let Some(st) = stack {
                    scope.set_extra("stack_trace", serde_json::Value::String(st.to_string()));
                }
            },
            || {
                sentry::capture_message(message, sentry::Level::Error);
            },
        );
    }
}
