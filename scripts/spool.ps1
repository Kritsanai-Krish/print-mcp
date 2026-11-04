# Prints PNG sheets through the Windows driver. Used for USB, shared and driver-only queues.
# stdin line 1: JSON settings. Then one PNG path per line, in print order.
# Sheets arrive as they are rendered, so the driver starts on page 1 straight away.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing

$cfg = [Console]::In.ReadLine() | ConvertFrom-Json

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.DocumentName = [string]$cfg.jobName
$ps = $doc.PrinterSettings
$ps.PrinterName = [string]$cfg.printer
if (-not $ps.IsValid) { throw "Printer not found: $($cfg.printer)" }
if ($cfg.outputFile) {
    $ps.PrintToFile = $true
    $ps.PrintFileName = [string]$cfg.outputFile
}
$ps.Copies = 1
$ps.Collate = $false
if ($ps.CanDuplex) {
    $ps.Duplex = switch ([string]$cfg.duplex) {
        'long' { [System.Drawing.Printing.Duplex]::Vertical }
        'short' { [System.Drawing.Printing.Duplex]::Horizontal }
        default { [System.Drawing.Printing.Duplex]::Simplex }
    }
}

$page = $doc.DefaultPageSettings
$page.Landscape = $false
$page.Color = [bool]$cfg.color
$page.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

# Hundredths of an inch; driver paper lists differ, so match by size and not by name.
$w = [int][math]::Round($cfg.widthMm / 25.4 * 100)
$h = [int][math]::Round($cfg.heightMm / 25.4 * 100)
$paper = $null
foreach ($candidate in $ps.PaperSizes) {
    if ([math]::Abs($candidate.Width - $w) -le 4 -and [math]::Abs($candidate.Height - $h) -le 4) { $paper = $candidate; break }
}
if (-not $paper) { $paper = New-Object System.Drawing.Printing.PaperSize('Custom', $w, $h) }
$page.PaperSize = $paper

if ($cfg.source) {
    foreach ($s in $ps.PaperSources) { if ($s.SourceName -like "*$($cfg.source)*") { $page.PaperSource = $s; break } }
}
$best = $null
foreach ($r in $ps.PrinterResolutions) {
    if ($cfg.quality -eq 'draft' -and $r.Kind -eq 'Draft') { $best = $r; break }
    if ($cfg.quality -eq 'high' -and $r.Kind -eq 'High') { $best = $r; break }
    if ($r.Kind -eq 'Custom' -and $r.X -eq $cfg.dpi) { $best = $r; break }
}
if ($best) { $page.PrinterResolution = $best }

$doc.OriginAtMargins = $false
$script:current = [Console]::In.ReadLine()
$script:count = 0

$doc.add_PrintPage({
    param($sender, $e)
    $img = [System.Drawing.Image]::FromFile($script:current)
    try {
        $g = $e.Graphics
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        # The origin is the printable corner. Shift back so sheet pixels map 1:1 onto paper.
        $rect = New-Object System.Drawing.RectangleF(
            (-$e.PageSettings.HardMarginX), (-$e.PageSettings.HardMarginY),
            [single]$e.PageBounds.Width, [single]$e.PageBounds.Height)
        $g.DrawImage($img, $rect)
    } finally {
        $img.Dispose()
    }
    $script:count++
    [Console]::Out.WriteLine("sent $script:count")
    [Console]::Out.Flush()
    Remove-Item -LiteralPath $script:current -ErrorAction SilentlyContinue
    $next = [Console]::In.ReadLine()
    if ($next) { $script:current = $next; $e.HasMorePages = $true } else { $e.HasMorePages = $false }
})

if (-not $script:current) { throw 'No pages to print' }
# "Let Windows manage my default printer" moves the default to whatever printed last.
# A job from this tool must not change the user's machine setting as a side effect.
$defaultBefore = Get-CimInstance Win32_Printer -Filter 'Default=True' -ErrorAction SilentlyContinue
try {
    $doc.Print()
} finally {
    if ($defaultBefore) {
        $defaultNow = Get-CimInstance Win32_Printer -Filter 'Default=True' -ErrorAction SilentlyContinue
        if (-not $defaultNow -or $defaultNow.Name -ne $defaultBefore.Name) {
            Invoke-CimMethod -InputObject $defaultBefore -MethodName SetDefaultPrinter -ErrorAction SilentlyContinue | Out-Null
        }
    }
}
[Console]::Out.WriteLine("done $script:count")
