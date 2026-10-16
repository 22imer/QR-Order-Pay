param([switch]$Stop)

$ErrorActionPreference = 'Continue'
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cachePath = Join-Path $projectPath '.cache'
$envPath = Join-Path $projectPath '.env'
$urlPath = Join-Path $cachePath 'public-url.txt'
$originalPath = Join-Path $cachePath 'public-original-url.txt'
$containerName = 'fantastic-public-tunnel'
New-Item -ItemType Directory -Path $cachePath -Force -ErrorAction Stop | Out-Null

function Invoke-AppDocker {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw "Docker failed: $($args[0])" }
}

function Set-PublicUrl([string]$value) {
    $envText = [System.IO.File]::ReadAllText($envPath)
    if ($envText -match '(?m)^PUBLIC_APP_URL=') {
        $envText = [regex]::Replace($envText, '(?m)^PUBLIC_APP_URL=[^\r\n]*', "PUBLIC_APP_URL=$value")
    } else {
        $envText = $envText.TrimEnd() + "`nPUBLIC_APP_URL=$value`n"
    }
    [System.IO.File]::WriteAllText($envPath, $envText, [System.Text.UTF8Encoding]::new($false))
}

Push-Location $projectPath
try {
    if ($Stop) {
        $existing = & docker ps -a --filter "name=^$containerName`$" --format '{{.ID}}'
        if ($existing) { Invoke-AppDocker stop $containerName | Out-Null }
        $restoreUrl = if (Test-Path -LiteralPath $originalPath) { ([System.IO.File]::ReadAllText($originalPath)).Trim() } else { 'http://localhost:8080' }
        Set-PublicUrl $restoreUrl
        Invoke-AppDocker compose -f compose.production.yaml up -d --no-build --wait
        Write-Output "Public tunnel stopped. Guest: $restoreUrl"
        return
    }

    # Reuse built app images; changing a tunnel hostname does not require a frontend rebuild.
    Invoke-AppDocker compose -f compose.production.yaml -f compose.public.yaml up -d --no-build --wait
    if (!(Test-Path -LiteralPath $originalPath)) {
        $envText = [System.IO.File]::ReadAllText($envPath)
        $previous = [regex]::Match($envText, '(?m)^PUBLIC_APP_URL=([^\r\n]+)').Groups[1].Value.Trim().Trim('"').Trim("'")
        if (!$previous) { $previous = 'http://localhost:8080' }
        [System.IO.File]::WriteAllText($originalPath, $previous, [System.Text.UTF8Encoding]::new($false))
    }
    $existing = & docker ps -a --filter "name=^$containerName`$" --format '{{.ID}}'
    if (!$existing) {
        Invoke-AppDocker run -d --name $containerName --network maycafe-production_default cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://web:8080 --protocol http2 | Out-Null
    } elseif ((& docker inspect -f '{{.State.Running}}' $containerName) -ne 'true') {
        Invoke-AppDocker start $containerName | Out-Null
    }
    $startedAt = & docker inspect -f '{{.State.StartedAt}}' $containerName
    $publicUrl = $null
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $tunnelLog = (& docker logs --since $startedAt $containerName 2>&1 | Out-String)
        $urls = [regex]::Matches($tunnelLog, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($urls.Count) { $publicUrl = $urls[$urls.Count - 1].Value; break }
        Start-Sleep -Seconds 2
    }
    if (!$publicUrl) { throw 'Cloudflare did not return a public URL. Check docker logs fantastic-public-tunnel.' }
    Set-PublicUrl $publicUrl
    [System.IO.File]::WriteAllText($urlPath, $publicUrl, [System.Text.UTF8Encoding]::new($false))
    Invoke-AppDocker compose -f compose.production.yaml -f compose.public.yaml up -d --no-build --wait
    Write-Output "Public guest: $publicUrl/menu"
    Write-Output 'Choose a table in Staff/Admin and open its QR display. Keep this PC and Docker running.'
} finally { Pop-Location }
