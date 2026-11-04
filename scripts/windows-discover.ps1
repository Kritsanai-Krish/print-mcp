# Lists Windows print queues with capabilities as UTF-8 JSON on stdout.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing

$wsdRoot = 'HKLM:\SYSTEM\CurrentControlSet\Control\Print\Monitors\WSD Port\Ports'
$tcpPorts = @{}
Get-PrinterPort -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.PrinterHostAddress) { $tcpPorts[$_.Name] = $_.PrinterHostAddress }
}
$defaultName = (Get-CimInstance Win32_Printer -Filter 'Default=True' -ErrorAction SilentlyContinue).Name
$cimByName = @{}
Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue | ForEach-Object { $cimByName[$_.Name] = $_ }

$result = foreach ($q in (Get-Printer)) {
    $port = [string]$q.PortName
    $uuid = $null
    if ($port -like 'WSD-*' -and (Test-Path "$wsdRoot\$port")) {
        $uuid = (Get-ItemProperty "$wsdRoot\$port" -ErrorAction SilentlyContinue).'Printer UUID'
    }
    $virtual = ($port -in @('PORTPROMPT:', 'nul:', 'FILE:', 'XPSPort:')) -or
               ($q.DriverName -match 'PDF|XPS|OneNote|Fax|Send to|Image Writer|Document Writer')
    $cim = $cimByName[$q.Name]
    $caps = $null
    try {
        $s = New-Object System.Drawing.Printing.PrinterSettings
        $s.PrinterName = $q.Name
        if ($s.IsValid) {
            $caps = [ordered]@{
                color = [bool]$s.SupportsColor
                duplex = [bool]$s.CanDuplex
                maxCopies = [int]$s.MaximumCopies
                papers = @($s.PaperSizes | ForEach-Object {
                    [ordered]@{ name = $_.PaperName; kind = [int]$_.RawKind
                        widthMm = [math]::Round($_.Width * 0.254, 1); heightMm = [math]::Round($_.Height * 0.254, 1) }
                })
                sources = @($s.PaperSources | ForEach-Object { $_.SourceName })
                resolutions = @($s.PrinterResolutions | ForEach-Object {
                    [ordered]@{ kind = [string]$_.Kind; x = [int]$_.X; y = [int]$_.Y }
                })
            }
        }
    } catch {
        [Console]::Error.WriteLine("caps failed for $($q.Name): $($_.Exception.Message)")
    }
    [ordered]@{
        name = [string]$q.Name
        driver = [string]$q.DriverName
        port = $port
        host = $tcpPorts[$port]
        uuid = $uuid
        isDefault = ($q.Name -eq $defaultName)
        offline = [bool]($cim -and $cim.WorkOffline)
        shared = [bool]$q.Shared
        status = [string]$q.PrinterStatus
        virtual = [bool]$virtual
        caps = $caps
    }
}
ConvertTo-Json -InputObject @($result) -Depth 6 -Compress
