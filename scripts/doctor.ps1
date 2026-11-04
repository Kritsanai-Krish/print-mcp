# Reads the printing health of this PC, or applies a fix that needs no admin rights.
# stdin: {"action", ...}. UTF-8 JSON on stdout.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$req = [Console]::In.ReadToEnd() | ConvertFrom-Json

function Get-QueueHealth {
    $hosts = @{}
    Get-PrinterPort -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.PrinterHostAddress) { $hosts[$_.Name] = $_.PrinterHostAddress }
    }
    $cim = @{}
    Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue | ForEach-Object { $cim[$_.Name] = $_ }
    foreach ($q in (Get-Printer -ErrorAction Stop)) {
        $port = [string]$q.PortName
        $virtual = ($port -in @('PORTPROMPT:', 'nul:', 'FILE:', 'XPSPort:')) -or
                   ($q.DriverName -match 'PDF|XPS|OneNote|Fax|Send to|Image Writer|Document Writer')
        $jobs = @(Get-PrintJob -PrinterName $q.Name -ErrorAction SilentlyContinue | ForEach-Object {
            [ordered]@{ id = [int]$_.Id; document = [string]$_.DocumentName; status = [string]$_.JobStatus }
        })
        [ordered]@{
            name = [string]$q.Name; driver = [string]$q.DriverName; port = $port; host = $hosts[$port]
            status = [string]$q.PrinterStatus; offline = [bool]($cim[$q.Name] -and $cim[$q.Name].WorkOffline)
            virtual = [bool]$virtual; jobs = $jobs
        }
    }
}

function Set-QueueState([string]$name, [string]$what) {
    $safe = $name.Replace('\', '\\').Replace("'", "\'")
    $p = Get-CimInstance Win32_Printer -Filter "Name='$safe'"
    if (-not $p) { throw "No queue named $name" }
    if ($what -eq 'online') {
        $p.WorkOffline = $false
        Set-CimInstance -InputObject $p
    } else {
        $r = Invoke-CimMethod -InputObject $p -MethodName Resume
        if ($r.ReturnValue -ne 0) { throw "Resume returned $($r.ReturnValue)" }
    }
}

$out = switch ([string]$req.action) {
    'inspect' {
        $svc = Get-Service Spooler
        $queues = @()
        $queueError = $null
        try { $queues = @(Get-QueueHealth) } catch { $queueError = $_.Exception.Message }
        # A printer on USB shows up by its USB class even when no driver has claimed it.
        $usb = @(Get-CimInstance Win32_PnPEntity -Property Name, DeviceID, HardwareID, CompatibleID, ConfigManagerErrorCode, PNPClass |
            Where-Object { ($_.CompatibleID -match '^USB\\Class_07') -or ($_.DeviceID -like 'USBPRINT\*') -or ($_.PNPClass -eq 'Printer') } |
            ForEach-Object {
                [ordered]@{ name = [string]$_.Name; id = [string]$_.DeviceID; errorCode = [int]$_.ConfigManagerErrorCode
                    hardwareIds = @($_.HardwareID | Select-Object -First 8) }
            })
        $protected = $false
        try {
            $policy = Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Printers\WPP' -ErrorAction Stop
            $protected = ($policy.WindowsProtectedPrintGroupPolicyState -eq 1)
        } catch { $protected = $false }
        [ordered]@{ spooler = [string]$svc.Status; spoolerStart = [string]$svc.StartType; queueError = $queueError
            queues = $queues; usb = $usb; protectedPrint = $protected }
    }
    'start-spooler' { Start-Service Spooler; [ordered]@{ ok = $true } }
    'set-queue' { Set-QueueState ([string]$req.name) ([string]$req.what); [ordered]@{ ok = $true } }
    'remove-jobs' {
        $removed = 0
        foreach ($id in $req.ids) {
            Remove-PrintJob -PrinterName ([string]$req.name) -ID ([int]$id)
            $removed++
        }
        [ordered]@{ removed = $removed }
    }
    'wifi-direct' {
        # Printers that never joined the network still broadcast their own DIRECT-xx network.
        $text = & netsh.exe wlan show networks 2>$null
        $names = @($text | ForEach-Object { if ($_ -match '^\s*SSID \d+\s*:\s*(DIRECT-.+?)\s*$') { $Matches[1] } })
        [ordered]@{ networks = $names }
    }
    'signature' {
        $s = Get-AuthenticodeSignature -LiteralPath ([string]$req.path)
        [ordered]@{ status = [string]$s.Status; signer = [string]$s.SignerCertificate.Subject }
    }
    'elevate' {
        # The Windows permission prompt is the user's own yes or no.
        $argList = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
            "`"$($req.script)`"", '-RequestFile', "`"$($req.requestFile)`"")
        try {
            Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList $argList
            [ordered]@{ declined = $false }
        } catch {
            [ordered]@{ declined = $true; error = $_.Exception.Message }
        }
    }
    default { throw "Unknown action $($req.action)" }
}
ConvertTo-Json -InputObject $out -Depth 6 -Compress
