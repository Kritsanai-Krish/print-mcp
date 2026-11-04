# Converts a Word, Excel or PowerPoint file to PDF through the installed Office.
# Reads {"input","output"} from stdin. Macros stay off, and password-protected
# files fail fast instead of opening an invisible prompt that would hang forever.
# Only the Office process this script started is ever closed: PowerPoint is single
# instance, so quitting blindly would close the deck the user is working on.
$ErrorActionPreference = 'Stop'
$req = [Console]::In.ReadToEnd() | ConvertFrom-Json
$in = [string]$req.input
$out = [string]$req.output
$ext = [IO.Path]::GetExtension($in).ToLowerInvariant()
$forceDisableMacros = 3
$noPassword = '__print_mcp_no_password__'

function Get-OfficePids($name) { @(Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) }

function Start-Office($progId, $processName) {
    $before = Get-OfficePids $processName
    $app = New-Object -ComObject $progId
    $new = @(Get-OfficePids $processName | Where-Object { $before -notcontains $_ })
    # The host kills these if the conversion hangs past its deadline.
    foreach ($id in $new) { [Console]::Out.WriteLine("office-pid $id"); [Console]::Out.Flush() }
    @{ App = $app; Pids = $new; Shared = ($new.Count -eq 0) }
}

function Stop-Office($o) {
    # Nothing new started means we borrowed the user's running instance: leave it open.
    if (-not $o.Shared) { try { $o.App.Quit() } catch { [Console]::Error.WriteLine("Quit failed: $($_.Exception.Message)") } }
    try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($o.App) } catch { }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    foreach ($id in $o.Pids) {
        $p = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($p -and -not $p.WaitForExit(3000)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    }
}

if ($ext -in '.doc', '.docx', '.docm', '.dot', '.dotx', '.rtf', '.odt') {
    $o = Start-Office 'Word.Application' 'WINWORD'
    $doc = $null
    try {
        $o.App.Visible = $false
        $o.App.DisplayAlerts = 0
        $o.App.AutomationSecurity = $forceDisableMacros
        # FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument
        $doc = $o.App.Documents.Open($in, $false, $true, $false, $noPassword)
        $doc.ExportAsFixedFormat($out, 17)
    } finally {
        if ($doc) { try { $doc.Close(0) } catch { } }
        Stop-Office $o
    }
} elseif ($ext -in '.xls', '.xlsx', '.xlsm', '.xlsb', '.ods') {
    $o = Start-Office 'Excel.Application' 'EXCEL'
    $book = $null
    try {
        $o.App.Visible = $false
        $o.App.DisplayAlerts = $false
        $o.App.AutomationSecurity = $forceDisableMacros
        # FileName, UpdateLinks=0, ReadOnly, Format, Password
        $book = $o.App.Workbooks.Open($in, 0, $true, [Type]::Missing, $noPassword)
        $book.ExportAsFixedFormat(0, $out)
    } finally {
        if ($book) { try { $book.Close($false) } catch { } }
        Stop-Office $o
    }
} elseif ($ext -in '.ppt', '.pptx', '.pptm', '.pps', '.ppsx', '.odp') {
    $o = Start-Office 'PowerPoint.Application' 'POWERPNT'
    $deck = $null
    try {
        $o.App.AutomationSecurity = $forceDisableMacros
        # FileName, ReadOnly, Untitled, WithWindow
        $deck = $o.App.Presentations.Open($in, -1, 0, 0)
        $deck.SaveAs($out, 32)
    } finally {
        if ($deck) { try { $deck.Close() } catch { } }
        Stop-Office $o
    }
} else {
    throw "Unsupported Office file type: $ext"
}
