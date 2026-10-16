param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')][string]$Repository,
  [Parameter(Mandatory=$true)][string]$PublicKeyPath
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot 'src-tauri/tauri.conf.json'
$publicKey = (Get-Content -LiteralPath $PublicKeyPath -Raw).Trim()
if (-not $publicKey) { throw 'The public key file is empty.' }
$decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($publicKey))
if ($decoded -notmatch 'minisign public key') { throw 'Use the Tauri .pub public key, not the private signing key.' }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$config.plugins.updater.pubkey = $publicKey
$config.plugins.updater.endpoints = @("https://github.com/$Repository/releases/latest/download/latest.json")
$json = $config | ConvertTo-Json -Depth 30
[IO.File]::WriteAllText($configPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Output "Configured GitHub Releases updates for $Repository. Development runs still do not install updates."
