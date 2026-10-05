$extensions = Join-Path $HOME ".omo\agent\extensions"
$themes = Join-Path $HOME ".omo\agent\themes"

New-Item -ItemType Directory -Force $extensions | Out-Null
New-Item -ItemType Directory -Force $themes | Out-Null
Copy-Item (Join-Path $PSScriptRoot "extension\tool-fold.ts") (Join-Path $extensions "tool-fold.ts") -Force
Write-Host "installed -> $(Join-Path $extensions 'tool-fold.ts')"
Copy-Item (Join-Path $PSScriptRoot "themes\grok-day-focus.json") (Join-Path $themes "grok-day-focus.json") -Force
Write-Host "installed -> $(Join-Path $themes 'grok-day-focus.json')"
Write-Host "Running omo sessions pick it up at their next idle point (or type /reload)."
Write-Host 'To use the theme set "theme": "grok-day-focus" in ~/.omo/agent/settings.json.'
