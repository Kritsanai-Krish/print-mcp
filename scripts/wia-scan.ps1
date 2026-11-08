# Scans one page through Windows WIA. stdin: {"name","dpi","intent","feeder","out"}. stdout: {"name"} or {"error"}.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$req = [Console]::In.ReadToEnd() | ConvertFrom-Json
$JPEG = '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'

function Fail([string]$msg) { ConvertTo-Json -InputObject @{ error = $msg } -Compress; exit 0 }
function Set-Prop($props, [int]$id, $value) {
    foreach ($p in $props) { if ($p.PropertyID -eq $id) { try { $p.Value = $value } catch {} } }
}
function Max-Prop($props, [int]$id) {
    foreach ($p in $props) { if ($p.PropertyID -eq $id) { try { $p.Value = $p.SubTypeMax } catch {} } }
}

$scanners = @()
try { foreach ($d in (New-Object -ComObject WIA.DeviceManager).DeviceInfos) { if ($d.Type -eq 1) { $scanners += $d } } }
catch { Fail "Windows scanning (WIA) is not available: $($_.Exception.Message)" }
if (-not $scanners.Count) { Fail 'No scanner found. Connect it by USB or to the same network, and install its driver.' }

$pick = $null
if ($req.name) { $pick = $scanners | Where-Object { ([string]$_.Properties.Item('Name').Value).IndexOf([string]$req.name, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1 }
if (-not $pick) {
    if ($req.name -and $scanners.Count -gt 1) { Fail "No scanner matches '$($req.name)'. Scanners: $(($scanners | ForEach-Object { $_.Properties.Item('Name').Value }) -join ', ')" }
    $pick = $scanners[0]
}
$name = [string]$pick.Properties.Item('Name').Value

try {
    $dev = $pick.Connect()
    # 3088 Document Handling Select: 1 feeder, 2 flatbed
    Set-Prop $dev.Properties 3088 $(if ($req.feeder) { 1 } else { 2 })
    $item = $dev.Items.Item(1)
    Set-Prop $item.Properties 6146 ([int]$req.intent)   # color intent
    Set-Prop $item.Properties 6147 ([int]$req.dpi)      # horizontal dpi
    Set-Prop $item.Properties 6148 ([int]$req.dpi)      # vertical dpi
    # Extents are in pixels at the chosen dpi, so widen them only after setting it.
    Max-Prop $item.Properties 6151
    Max-Prop $item.Properties 6152
    $img = $item.Transfer($JPEG)
    if ($img.FormatID -eq $JPEG) { $img.SaveFile([string]$req.out) }
    else {
        # Many drivers ignore the JPEG request and hand back BMP; WIA.ImageProcess fails from PowerShell, so convert in .NET.
        Add-Type -AssemblyName System.Drawing
        $stream = [System.IO.MemoryStream]::new([byte[]]$img.FileData.BinaryData)
        $bmp = [System.Drawing.Image]::FromStream($stream)
        try { $bmp.Save([string]$req.out, [System.Drawing.Imaging.ImageFormat]::Jpeg) } finally { $bmp.Dispose(); $stream.Dispose() }
    }
} catch {
    $hr = '0x{0:X8}' -f $_.Exception.HResult
    $why = @{
        '0x80210002' = 'Paper jam in the scanner. Clear it and try again.'
        '0x80210003' = 'The document feeder is empty. Put the pages in, face up.'
        '0x80210005' = 'The scanner is offline. Turn it on and check the cable or network.'
        '0x80210006' = 'The scanner is busy. Try again in a moment.'
        '0x80210016' = 'The scanner cover is open. Close it.'
        '0x8021000A' = 'The scanner is busy or warming up. Try again in a moment.'
    }[$hr]
    if (-not $why) { $why = "$name failed to scan ($hr): $($_.Exception.Message)" }
    Fail $why
}
ConvertTo-Json -InputObject @{ name = $name } -Compress
