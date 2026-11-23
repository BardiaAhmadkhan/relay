[CmdletBinding()]
param(
    [string]$DeviceSerial,
    [switch]$ConnectOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $repoRoot '.tooling\android-sdk\platform-tools\adb.exe'
$apk = Join-Path $repoRoot 'artifacts\relay-round04-android.apk'
$expectedHash = '8e95323262d02a678a946c354c2bff5a67ba92e19677b2c6081a5a7d900b6be7'
$packageName = 'ca.relaygearlab.experimental'

function Invoke-RelayAdb {
    param([string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    $output = @(& $adb @Arguments 2>&1)
    $code = $LASTEXITCODE
    $result = ($output | Out-String).Trim()
    if ($code -ne 0) { throw "ADB failed ($code): $result" }
    return $result
}

try {
    if (!(Test-Path -LiteralPath $adb -PathType Leaf)) { throw "Android tools not found: $adb" }
    if (!(Test-Path -LiteralPath $apk -PathType Leaf)) { throw "APK not found: $apk" }
    if ((Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash -ne $expectedHash) {
        throw 'APK integrity check failed. Use the verified Relay package.'
    }
    Write-Host 'Verified Relay 0.1.0 APK (62.3 MB).'

    if (!$DeviceSerial) {
        try { $DeviceSerial = Invoke-RelayAdb -Arguments @('-d', 'get-serialno') }
        catch {
            throw 'Connect one Android phone by USB, enable USB debugging, and accept this computer on the phone. Then run this installer again. Use -DeviceSerial SERIAL if more than one phone is attached.'
        }
    }
    $target = @('-s', $DeviceSerial)
    if ((Invoke-RelayAdb -Arguments ($target + @('get-state'))) -ne 'device') {
        throw 'The phone is not ready. Unlock it and accept the USB debugging prompt.'
    }
    $sdk = [int](Invoke-RelayAdb -Arguments ($target + @('shell', 'getprop', 'ro.build.version.sdk')))
    $abis = Invoke-RelayAdb -Arguments ($target + @('shell', 'getprop', 'ro.product.cpu.abilist'))
    if ($sdk -lt 24 -or $abis -notmatch '(^|,)(arm64-v8a|x86_64)(,|$)') {
        throw 'This APK requires Android 7 or later and a 64-bit ARM or x86 Android system.'
    }
    Write-Host "Device ready: Android API $sdk ($abis)."

    if (!$ConnectOnly) {
        Write-Host 'Installing Relay; existing app records are retained.'
        Write-Host (Invoke-RelayAdb -Arguments ($target + @('install', '-r', $apk)))
    } else {
        $installed = Invoke-RelayAdb -Arguments ($target + @('shell', 'pm', 'path', $packageName))
        if ($installed -notmatch '^package:') { throw 'Relay is not installed. Run without -ConnectOnly first.' }
    }

    $health = $null
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 6 }
    catch { Write-Warning 'The computer inspection service is not running. Capture and saved records still work. See the Android installation guide to start it.' }
    if ($null -ne $health -and ($health.status -ne 'ok' -or $health.provider -ne 'local_vlm' -or $health.externalProvider -ne $false -or $health.schemaVersion -ne '1.0')) {
        throw 'Relay was installed, but port 8787 is not the expected local inspection service. The USB connection was not changed.'
    }

    $existing = Invoke-RelayAdb -Arguments ($target + @('reverse', '--list'))
    $portMapping = @($existing -split '\r?\n' | Where-Object { $_ -match '\s+tcp:8787\s+' })
    if ($portMapping.Count -gt 0 -and @($portMapping | Where-Object { $_ -notmatch '\s+tcp:8787\s+tcp:8787\s*$' }).Count -gt 0) {
        throw 'Phone port 8787 already maps to another service. No existing mapping was replaced.'
    }
    if ($portMapping.Count -eq 0) {
        $null = Invoke-RelayAdb -Arguments ($target + @('reverse', '--no-rebind', 'tcp:8787', 'tcp:8787'))
    }
    $mapping = Invoke-RelayAdb -Arguments ($target + @('reverse', '--list'))
    if ($mapping -notmatch '\s+tcp:8787\s+tcp:8787(\s|$)') { throw 'USB port mapping could not be verified.' }

    $launch = Invoke-RelayAdb -Arguments ($target + @('shell', 'am', 'start', '-W', '-n', "$packageName/.MainActivity"))
    if ($launch -match '(?m)^Error') { throw $launch }
    Write-Host ''
    Write-Host 'Relay is installed and its USB connection is ready.'
    Write-Host 'In Connection & privacy, use http://127.0.0.1:8787 with an empty access token, then Save and check connection.'
    if ($null -ne $health) { Write-Host "Computer service: $($health.model) (local processing)." }
    else { Write-Host 'Full inspection will work after the computer service starts.' }
    Write-Host 'Keep this computer running and the USB cable connected for inspection. Re-run after reconnecting the cable.'
    exit 0
} catch {
    Write-Host ''
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
