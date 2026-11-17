$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    $nodeExecutable = $nodeCommand.Source
} else {
    $toolsDirectory = Join-Path $env:LOCALAPPDATA 'amazon-debloated-tools'
    $portableNode = Get-ChildItem -Path $toolsDirectory -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $portableNode) { throw 'Install Node.js 22 or newer, then run npm start.' }
    $nodeExecutable = $portableNode.FullName
}
& $nodeExecutable (Join-Path $PSScriptRoot 'server.mjs')
exit $LASTEXITCODE
