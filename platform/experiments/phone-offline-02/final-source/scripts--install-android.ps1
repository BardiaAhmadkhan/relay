[CmdletBinding()]
param([string]$DeviceSerial)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $repoRoot '.tooling\android-sdk\platform-tools\adb.exe'
$apk = Join-Path $repoRoot 'artifacts\Relay-0.2-offline-android.apk'
$record = Join-Path $repoRoot 'artifacts\Relay-0.2-offline-android.json'
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
    if (!(Test-Path -LiteralPath $adb -PathType Leaf)) { throw "Android tools not found: $adb. You can instead copy the APK to your phone and open it in My Files." }
    if (!(Test-Path -LiteralPath $apk -PathType Leaf) -or !(Test-Path -LiteralPath $record -PathType Leaf)) { throw 'The verified offline APK and its integrity record must both be in the artifacts folder.' }
    $metadata = Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
    if ((Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash -ne $metadata.sha256) { throw 'APK integrity check failed.' }
    Write-Host 'Verified Relay 0.2 offline APK. The computer is used only for this optional installation step.'
    if (!$DeviceSerial) {
        try { $DeviceSerial = Invoke-RelayAdb -Arguments @('-d', 'get-serialno') }
        catch { throw 'Connect one Android phone by USB, enable USB debugging and accept its prompt. Alternatively, copy the APK to your phone and install it in My Files. No USB connection is needed afterward.' }
    }
    $target = @('-s', $DeviceSerial)
    if ((Invoke-RelayAdb -Arguments ($target + @('get-state'))) -ne 'device') { throw 'Unlock the phone and accept its USB debugging prompt.' }
    $sdk = [int](Invoke-RelayAdb -Arguments ($target + @('shell', 'getprop', 'ro.build.version.sdk')))
    $abis = Invoke-RelayAdb -Arguments ($target + @('shell', 'getprop', 'ro.product.cpu.abilist'))
    if ($sdk -lt 24 -or $abis -notmatch '(^|,)(arm64-v8a|x86_64)(,|$)') { throw 'This APK needs a 64-bit Android system with Android 7 or newer.' }
    Write-Host 'Installing Relay while retaining existing app records. The large bundled model can make this take several minutes.'
    Write-Host (Invoke-RelayAdb -Arguments ($target + @('install', '-r', $apk)))
    $launch = Invoke-RelayAdb -Arguments ($target + @('shell', 'am', 'start', '-W', '-n', "$packageName/.MainActivity"))
    if ($launch -match '(?m)^Error') { throw $launch }
    Write-Host 'Relay is installed. Disconnect the cable and use the app on the phone.'
    Write-Host 'No computer service, account, API key, network connection or port forwarding is needed.'
    exit 0
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
