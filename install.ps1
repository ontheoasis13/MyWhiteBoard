param(
  [string]$Source = "ontheoasis13/My-WhiteBoard",
  [string]$Ref = "main"
)

$ErrorActionPreference = "Stop"

codex plugin marketplace add $Source --ref $Ref
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

codex plugin add my-whiteboard@my-whiteboard
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Output "My Whiteboard is installed. Start a new Codex task to use it."
