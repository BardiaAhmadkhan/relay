param([ValidatePattern('^[a-z0-9-]{1,48}$')][string]$Rehearsal='presenter')
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$node=(Get-Command node -ErrorAction Stop).Source
$python=Join-Path $env:LOCALAPPDATA 'Programs\Python\Python310\python.exe'
if(-not(Test-Path -LiteralPath $python)){$python=(Get-Command python -ErrorAction Stop).Source}
$log=Join-Path $root '.local\inspection\v4-launch-logs'
[void][IO.Directory]::CreateDirectory($log)
$stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
function Get-RelayHealth([string]$Uri){
  try{return Invoke-RestMethod -Uri $Uri -TimeoutSec 2 -ErrorAction Stop}catch{return $null}
}
function Start-RelayProcess([string]$Name,[string[]]$Arguments){
  $out=Join-Path $log ($Name+'-'+$stamp+'-out.log')
  $err=Join-Path $log ($Name+'-'+$stamp+'-err.log')
  Start-Process -FilePath $node -ArgumentList $Arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru | Out-Null
}
function Wait-RelayHealth([string]$Uri,[int]$Seconds){
  $until=[DateTime]::UtcNow.AddSeconds($Seconds)
  do{$result=Get-RelayHealth $Uri;if($result){return $result};Start-Sleep -Seconds 1}while([DateTime]::UtcNow -lt $until)
  return $null
}
Push-Location -LiteralPath $root
try{
  $v35=Get-RelayHealth 'http://127.0.0.1:8788/v2/health'
  if(-not $v35){
    Start-RelayProcess 'v35' @('--env-file=.env','--import','tsx','deploy/serve.mjs')
    $v35=Wait-RelayHealth 'http://127.0.0.1:8788/v2/health' 90
  }
  $desk=Get-RelayHealth 'http://127.0.0.1:8794/v4/health'
  if(-not $desk){
    $relative='.local/inspection/v4-private-rehearsals/'+$Rehearsal+'/items'
    if(-not(Test-Path -LiteralPath (Join-Path $root $relative))){
       & $node '--env-file=.env' '--import' 'tsx' 'scripts/v4/prepare-rehearsal.ts' $Rehearsal
       if($LASTEXITCODE -ne 0){throw 'Could not prepare the private event set.'}
    }
    $env:RELAY_V4_DATA=$relative;$env:RELAY_V4_PORT='8794';$env:RELAY_V4_HOST='127.0.0.1';$env:RELAY_V4_DEMO='1';$env:RELAY_V4_PYTHON=$python
    Start-RelayProcess 'event' @('--env-file=.env','--import','tsx','server/v4/index.ts')
    $desk=Wait-RelayHealth 'http://127.0.0.1:8794/v4/health' 15
  }
  $view=Get-RelayHealth 'http://127.0.0.1:8793/health'
  if(-not $view){
    $env:RELAY_V4_PREVIEW_PORT='8793';$env:RELAY_V4_PREVIEW_API_PORT='8794';$env:RELAY_V4_PREVIEW_BUILD='relay-v4-event-preview'
    Start-RelayProcess 'presenter' @('scripts/v4/preview.mjs')
    $view=Wait-RelayHealth 'http://127.0.0.1:8793/health' 10
  }
  $testRoot='.local/inspection/v4-private-rehearsals/ux-review/items'
  if(Test-Path -LiteralPath (Join-Path $root $testRoot)){
    if(-not (Get-RelayHealth 'http://127.0.0.1:8804/v4/health')){
      $env:RELAY_V4_DATA=$testRoot;$env:RELAY_V4_PORT='8804';$env:RELAY_V4_HOST='127.0.0.1';$env:RELAY_V4_DEMO='1';$env:RELAY_V4_PYTHON=$python
      Start-RelayProcess 'owner-test-api' @('--env-file=.env','--import','tsx','server/v4/index.ts')
      [void](Wait-RelayHealth 'http://127.0.0.1:8804/v4/health' 15)
    }
    if(-not (Get-RelayHealth 'http://127.0.0.1:8792/health')){
      $env:RELAY_V4_PREVIEW_PORT='8792';$env:RELAY_V4_PREVIEW_API_PORT='8804';$env:RELAY_V4_PREVIEW_BUILD='relay-v4-event-preview'
      Start-RelayProcess 'owner-test-presenter' @('scripts/v4/preview.mjs')
    }
  }
  [pscustomobject]@{Foundation=$v35.engineRelease;Original4B=(Get-RelayHealth 'http://127.0.0.1:11439/api/tags').models.name -contains 'qwen3.5:4b';EventAPI=$desk.status;SignedRecords=$desk.ready;DemoMode=$desk.demo;MobileBundle=$view.eventBundle;RecordedScreens=$view.screenshots}
  if($desk.status -ne 'ok' -or -not $desk.demo -or -not $view.eventBundle){throw 'A demo service is unavailable. Read the most recent event or presenter log. The recorded fallback requires only scripts/v4/preview.mjs.'}
  if($v35.engineRelease -ne '3.5'){Write-Warning 'Saved signed cases and the recorded presentation are available; fresh local 4B inference requires the V3.5 service.'}
  Write-Output 'Mobile-layout presenter: http://127.0.0.1:8793/'
  Write-Output 'Recorded fallback: http://127.0.0.1:8793/fallback'
  Write-Output 'Complete vision: http://127.0.0.1:8793/vision'
}finally{Pop-Location}
