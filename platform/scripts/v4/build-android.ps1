param([Parameter(Mandatory=$true)][string]$Prepared)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$preparedPath=(Resolve-Path -LiteralPath $Prepared).Path
$prefix=(Join-Path $root '.cache')+'\ph-'
if(-not $preparedPath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $preparedPath) -ne 'app'){throw 'Choose the clean API client created by scripts/mobile-client.mjs android --prepare.'}
$android=Join-Path $preparedPath 'android'
$build=Get-Content -Raw -LiteralPath (Join-Path $android 'app\build.gradle')
if($build -notmatch 'ca\.relaygearlab\.fielddesk'){throw 'The prepared project is not the isolated event package.'}
$nativeAssets=Join-Path $android 'app\src\main\assets'
if((Test-Path -LiteralPath $nativeAssets) -and (Get-ChildItem -LiteralPath $nativeAssets -File -Recurse | Where-Object { $_.Extension -in '.gguf','.onnx','.safetensors' })){throw 'Unexpected model asset in prepared field client.'}
# Refresh edited application code without regenerating or touching the archived offline Android tree.
foreach($appFile in 'App.tsx','metro.config.js','app.config.js'){Copy-Item -LiteralPath (Join-Path (Join-Path $root 'app') $appFile) -Destination (Join-Path $preparedPath $appFile) -Force}
Get-ChildItem -LiteralPath (Join-Path $root 'app\src\v4') -File | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination (Join-Path (Join-Path $preparedPath 'src\v4') $_.Name) -Force}
$shared=Join-Path (Split-Path $preparedPath) 'packages\core\v4'
Get-ChildItem -LiteralPath (Join-Path $root 'packages\core\v4') -Filter '*.ts' -File | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $shared $_.Name) -Force}
$env:JAVA_HOME=Join-Path $root '.tooling\jdk\jdk-21.0.12.1+1'
$env:ANDROID_HOME=Join-Path $root '.tooling\android-sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:GRADLE_USER_HOME=Join-Path $root '.cache\gradle'
$env:RELAY_MOBILE_PROFILE='event'
$env:EXPO_PUBLIC_RELAY_EVENT_DESK='1'
$env:EXPO_PUBLIC_RELAY_V4_API_URL='http://127.0.0.1:8794'
$env:EXPO_NO_TELEMETRY='1'
$env:NODE_ENV='production'
$env:CI='1'
Push-Location -LiteralPath $android
try{
  & (Join-Path $env:JAVA_HOME 'bin\java.exe') '-Xmx64m' '-Xms64m' '-Dorg.gradle.appname=gradlew' '-jar' 'gradle\wrapper\gradle-wrapper.jar' ':app:assembleRelease' '-PreactNativeArchitectures=arm64-v8a,x86_64' '--offline' '--no-daemon' '--max-workers=1' '-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=768m' '--console=plain'
  if($LASTEXITCODE -ne 0){throw 'The Android application build failed.'}
}finally{Pop-Location}
$apk=Join-Path $android 'app\build\outputs\apk\release\app-release.apk'
$target=Join-Path $root 'artifacts\relay-v4-event'
[void][IO.Directory]::CreateDirectory($target)
$hash=(Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLower()
$delivery=Join-Path $target ('Relay-Field-Desk-'+$hash.Substring(0,12)+'.apk')
if(-not(Test-Path -LiteralPath $delivery)){Copy-Item -LiteralPath $apk -Destination $delivery}
Get-Item -LiteralPath $delivery | Select-Object Name,Length
Write-Output ('SHA-256 '+$hash)
