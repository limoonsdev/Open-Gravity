// Embeds the router core (the Node.js single executable, gzip-compressed) into
// the desktop binary so the whole app ships as one file. Set OG_CORE_PAYLOAD to
// the .gz file; without it the app is built in "external core" mode (dev).
use std::{env, fs, path::PathBuf};

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

fn main() {
    println!("cargo:rerun-if-env-changed=OG_CORE_PAYLOAD");
    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let bytes = match env::var("OG_CORE_PAYLOAD") {
        Ok(p) if !p.is_empty() => {
            println!("cargo:rerun-if-changed={p}");
            fs::read(&p).unwrap_or_else(|e| panic!("cannot read OG_CORE_PAYLOAD {p}: {e}"))
        }
        _ => Vec::new(),
    };
    fs::write(out.join("core.gz"), &bytes).expect("write core payload");
    println!("cargo:rustc-env=OG_CORE_ID={:016x}", fnv1a(&bytes));

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_info",
            "open_external",
            "restart_core",
            "set_autostart",
            "set_close_to_tray",
            "quit_app",
            "core_logs",
        ]),
    ))
    .expect("failed to run tauri-build");
}
