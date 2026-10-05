# One-line install, no clone needed:
#   irm https://raw.githubusercontent.com/yjacket/omo-tool-fold/master/install.ps1 | iex
# Run from a clone (.\install.ps1) it copies the local files instead.
& {
    param($root)
    $ErrorActionPreference = "Stop"
    $ProgressPreference = "SilentlyContinue"
    $base = "https://raw.githubusercontent.com/yjacket/omo-tool-fold/master"
    $agent = Join-Path $HOME ".omo\agent"
    $files = @(
        @{ Src = "extension/tool-fold.ts"; Dst = "extensions\tool-fold.ts" },
        @{ Src = "themes/grok-day-focus.json"; Dst = "themes\grok-day-focus.json" }
    )
    foreach ($file in $files) {
        $dst = Join-Path $agent $file.Dst
        $tmp = [System.IO.Path]::GetTempFileName()
        try {
            $local = if ($root) { Join-Path $root $file.Src } else { $null }
            if ($local -and (Test-Path $local)) {
                Copy-Item $local $tmp -Force
            } else {
                Invoke-WebRequest -UseBasicParsing -Uri "$base/$($file.Src)" -OutFile $tmp
            }
            New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
            Copy-Item $tmp $dst -Force
            Write-Host "installed -> $dst"
        } finally {
            Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host "Running omo sessions pick it up at their next idle point (or type /reload)."
    Write-Host 'To use the theme set "theme": "grok-day-focus" in ~/.omo/agent/settings.json.'
} $PSScriptRoot
