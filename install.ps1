param(
  [string]$Source = "ontheoasis13/MyWhiteBoard",
  [string]$Ref = "v0.2.0-alpha.1"
)

$ErrorActionPreference = "Stop"

$localSource = Resolve-Path -LiteralPath $Source -ErrorAction SilentlyContinue
if ($localSource) {
  codex plugin marketplace add $localSource.Path
} else {
  codex plugin marketplace add $Source --ref $Ref
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

codex plugin add my-whiteboard@my-whiteboard
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Output "My Whiteboard is installed. Start a new Codex task to use it."
