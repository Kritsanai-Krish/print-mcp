# Runs one fixed repair that needs admin rights. Only the actions below exist, so the request
# file cannot make this run anything else. Writes UTF-8 JSON to the request's resultFile.
param([Parameter(Mandatory = $true)][string]$RequestFile)
$ErrorActionPreference = 'Stop'
$req = [System.IO.File]::ReadAllText($RequestFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$result = [ordered]@{ ok = $true }

function Find-Drivers($hardwareIds) {
    $session = New-Object -ComObject Microsoft.Update.Session
    $searcher = $session.CreateUpdateSearcher()
    $searcher.ServerSelection = 2
    $found = $searcher.Search("IsInstalled=0 and Type='Driver' and IsHidden=0").Updates
    $wanted = @($hardwareIds | ForEach-Object { ([string]$_).ToLowerInvariant() })
    $picked = New-Object -ComObject Microsoft.Update.UpdateColl
    foreach ($u in $found) {
        if (($u.DriverClass -eq 'Printer') -or ($wanted -contains ([string]$u.DriverHardwareID).ToLowerInvariant())) { [void]$picked.Add($u) }
    }
    return @{ session = $session; updates = $picked; scanned = $found.Count }
}

try {
    switch ([string]$req.action) {
        'restart-spooler' {
            if ((Get-Service Spooler).StartType -eq 'Disabled') { Set-Service Spooler -StartupType Automatic }
            Restart-Service Spooler -Force
        }
        'clear-spool' {
            Stop-Service Spooler -Force
            Get-ChildItem -LiteralPath (Join-Path $env:SystemRoot 'System32\spool\PRINTERS') -File | Remove-Item -Force
            Start-Service Spooler
        }
        'set-queue' {
            $safe = ([string]$req.name).Replace('\', '\\').Replace("'", "\'")
            $p = Get-CimInstance Win32_Printer -Filter "Name='$safe'"
            if (-not $p) { throw "No queue named $($req.name)" }
            if ($req.what -eq 'online') { $p.WorkOffline = $false; Set-CimInstance -InputObject $p }
            else { [void](Invoke-CimMethod -InputObject $p -MethodName Resume) }
        }
        'scan-devices' {
            $text = & pnputil.exe /scan-devices 2>&1 | Out-String
            $result.output = $text.Trim()
        }
        'wu-search' {
            $r = Find-Drivers $req.hardwareIds
            $result.scanned = $r.scanned
            $result.matched = @($r.updates | ForEach-Object { [string]$_.Title })
        }
        'wu-install' {
            $r = Find-Drivers $req.hardwareIds
            $result.scanned = $r.scanned
            $result.titles = @($r.updates | ForEach-Object { [string]$_.Title })
            if ($r.updates.Count -gt 0) {
                foreach ($u in $r.updates) { if (-not $u.EulaAccepted) { $u.AcceptEula() } }
                $down = $r.session.CreateUpdateDownloader()
                $down.Updates = $r.updates
                [void]$down.Download()
                $inst = $r.session.CreateUpdateInstaller()
                $inst.Updates = $r.updates
                $done = $inst.Install()
                $result.installResult = [int]$done.ResultCode
                $result.rebootRequired = [bool]$done.RebootRequired
            }
        }
        'add-inf' {
            $path = [string]$req.path
            $args = if ($req.folder) { @('/add-driver', (Join-Path $path '*.inf'), '/subdirs', '/install') } else { @('/add-driver', $path, '/install') }
            $text = & pnputil.exe @args 2>&1 | Out-String
            $result.output = $text.Trim()
            $result.exitCode = $LASTEXITCODE
            if ($LASTEXITCODE -notin @(0, 259, 3010)) { $result.ok = $false; $result.error = "pnputil exited with $LASTEXITCODE" }
        }
        'run-installer' {
            # Checked again here, in case the file changed after the user's side looked at it.
            $path = [string]$req.path
            $sig = Get-AuthenticodeSignature -LiteralPath $path
            if ($sig.Status -ne 'Valid') { throw "Installer signature is $($sig.Status); refusing to run it." }
            $p = if ($path -match '\.msi$') {
                Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$path`"") -Wait -PassThru
            } else {
                Start-Process -FilePath $path -Wait -PassThru
            }
            $result.exitCode = $p.ExitCode
        }
        default { throw "Unknown action $($req.action)" }
    }
} catch {
    $result.ok = $false
    $result.error = $_.Exception.Message
}
[System.IO.File]::WriteAllText([string]$req.resultFile, (ConvertTo-Json -InputObject $result -Depth 5 -Compress), [System.Text.UTF8Encoding]::new($false))
