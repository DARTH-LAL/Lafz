use std::env;

fn main() {
    println!("cargo:rerun-if-env-changed=LAFZ_API_BASE_URL");
    println!("cargo:rerun-if-env-changed=LAFZ_DESKTOP_API_BASE_URL");
    println!("cargo:rerun-if-env-changed=LAFZ_APP_URL");
    println!("cargo:rerun-if-env-changed=SUPABASE_URL");
    println!("cargo:rerun-if-env-changed=SUPABASE_ANON_KEY");

    if let Ok(desktop_api_base_url) = env::var("LAFZ_DESKTOP_API_BASE_URL") {
        let trimmed = desktop_api_base_url.trim().trim_end_matches('/');
        if !trimmed.is_empty() {
            println!("cargo:rustc-env=LAFZ_DESKTOP_API_BASE_URL={trimmed}");
            println!("cargo:rustc-env=LAFZ_API_BASE_URL={trimmed}");
        }
    } else if let Ok(api_base_url) = env::var("LAFZ_API_BASE_URL") {
        let trimmed = api_base_url.trim().trim_end_matches('/');
        if !trimmed.is_empty() {
            println!("cargo:rustc-env=LAFZ_API_BASE_URL={trimmed}");
        }
    } else if let Ok(app_url) = env::var("LAFZ_APP_URL") {
        let trimmed = app_url.trim().trim_end_matches('/');
        if !trimmed.is_empty() {
            println!("cargo:rustc-env=LAFZ_API_BASE_URL={trimmed}");
        }
    }

    if let Ok(supabase_url) = env::var("SUPABASE_URL") {
        let trimmed = supabase_url.trim().trim_end_matches('/');
        if !trimmed.is_empty() {
            println!("cargo:rustc-env=SUPABASE_URL={trimmed}");
        }
    }

    if let Ok(supabase_anon_key) = env::var("SUPABASE_ANON_KEY") {
        let trimmed = supabase_anon_key.trim();
        if !trimmed.is_empty() {
            println!("cargo:rustc-env=SUPABASE_ANON_KEY={trimmed}");
        }
    }

    tauri_build::build()
}
