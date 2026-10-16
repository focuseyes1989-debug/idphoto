// Local release QA. Uses the same Minisign verification library as Tauri's updater.
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 { return Err("Expected PUBLIC_KEY INSTALLER SIGNATURE VERSION".into()); }
    let key_text = String::from_utf8(STANDARD.decode(std::fs::read_to_string(&args[1])?.trim())?)?;
    let signature_text = String::from_utf8(STANDARD.decode(std::fs::read_to_string(&args[3])?.trim())?)?;
    let key = PublicKey::decode(&key_text)?;
    let signature = Signature::decode(&signature_text)?;
    let mut installer = std::fs::read(&args[2])?;
    key.verify(&installer, &signature, false)?;
    assert!(signature.trusted_comment().contains(&format!("version:{}", args[4])), "Signature must bind the release version");
    installer[0] ^= 1;
    assert!(key.verify(&installer, &signature, false).is_err(), "Tampered installer must fail verification");
    println!("{}: signature valid; signed version matches; tampered bytes rejected", args[4]);
    Ok(())
}
