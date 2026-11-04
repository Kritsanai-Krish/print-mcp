# Lists or cancels spooler jobs. stdin: {"action","printer","document","jobId"}.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$req = [Console]::In.ReadToEnd() | ConvertFrom-Json
$jobs = @(Get-PrintJob -PrinterName ([string]$req.printer) -ErrorAction SilentlyContinue)
if ($req.document) { $jobs = @($jobs | Where-Object { $_.DocumentName -eq [string]$req.document }) }
if ($req.action -eq 'cancel') {
    $removed = 0
    foreach ($j in $jobs) {
        if (-not $req.jobId -or $j.Id -eq [int]$req.jobId) {
            Remove-PrintJob -InputObject $j
            $removed++
        }
    }
    ConvertTo-Json -InputObject @{ removed = $removed } -Compress
} else {
    $out = @($jobs | ForEach-Object {
        [ordered]@{ id = [int]$_.Id; document = [string]$_.DocumentName; status = [string]$_.JobStatus
            pagesPrinted = [int]$_.PagesPrinted; totalPages = [int]$_.TotalPages }
    })
    ConvertTo-Json -InputObject $out -Compress
}
