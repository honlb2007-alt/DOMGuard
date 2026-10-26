# Stop only the calibration listener. Does not touch Chrome.
$ErrorActionPreference = 'Stop'
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | ForEach-Object {
    if ($_.CommandLine -and $_.CommandLine -like '*demo-calibrate.ps1*') {
        Stop-Process -Id $_.ProcessId -Force
        Write-Output ("stopped " + $_.ProcessId)
    }
}
