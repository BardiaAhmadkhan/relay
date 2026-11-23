param([string]$Serial, [switch]$AllowEmulator)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$adb=Join-Path $root '.tooling\android-sdk\platform-tools\adb.exe'
if(!(Test-Path -LiteralPath $adb)){throw 'The project Android SDK is missing.'}
$health=Invoke-RestMethod -Uri 'http://127.0.0.1:8788/v2/health' -TimeoutSec 6
if($health.engineRelease -ne '3.5'){throw 'Start the V3.5 loopback service before forwarding.'}
$devices=@(& $adb devices | ForEach-Object {
 if($_ -match '^(\S+)\s+device(\s|$)'){ $Matches[1] }
} | Where-Object { $AllowEmulator -or $_ -notmatch '^emulator-' })
if($Serial){
 if($devices -notcontains $Serial){throw 'The selected Android device is absent or has not authorized USB debugging.'}
}elseif($devices.Count -eq 1){$Serial=$devices[0]}
else{throw 'Connect and authorize one Android phone by USB, or choose its authorized serial with -Serial.'}
& $adb -s $Serial reverse tcp:8788 tcp:8788
if($LASTEXITCODE -ne 0){throw 'Port forwarding failed.'}
$forward=@(& $adb -s $Serial reverse --list)
if(-not ($forward -match '\btcp:8788\s+tcp:8788\b')){throw 'Android did not confirm port forwarding.'}
Write-Output 'USB backup is ready. On the phone use http://127.0.0.1:8788 in Connection settings.'
