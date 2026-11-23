param([Parameter(Mandatory=$true)][string]$Prepared)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$cache=(Resolve-Path -LiteralPath (Join-Path $root '.cache')).Path
$src=(Resolve-Path -LiteralPath $Prepared).Path
$dst=(Resolve-Path -LiteralPath (Join-Path $cache 'relay-v4-event-preview')).Path
if(-not $src.StartsWith((Join-Path $cache 'relay-v4-preview-'),[StringComparison]::OrdinalIgnoreCase) -or $src -eq $dst){throw 'Expected a separate event-preview staging directory.'}
$entry=Join-Path $src 'index.html'
if(-not (Test-Path -LiteralPath $entry)){throw 'No exported entry page.'}
$rootPrefix=$src+'\'
foreach($file in (Get-ChildItem -LiteralPath $src -File -Recurse)){
 if($file.FullName -eq $entry){continue}
 $relative=$file.FullName.Substring($rootPrefix.Length)
 $target=Join-Path $dst $relative
 [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
 [IO.File]::Copy($file.FullName,$target,$true)
}
# Old file hashes stay available to an already-running presentation tab; only the small entry page switches.
$next=Join-Path $dst ('index-'+[Guid]::NewGuid().ToString('N')+'.tmp')
[IO.File]::Copy($entry,$next)
[IO.File]::Replace($next,(Join-Path $dst 'index.html'),[System.Management.Automation.Language.NullString]::Value)
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $dst 'index.html') | Select-Object Hash
