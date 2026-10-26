# Record only the demo window, then open DOMGuard. No audio.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$OutDir = Join-Path $Root 'demo\out'
$Ffmpeg = 'C:\Users\lickb\AppData\Local\CapCut\Apps\9.5.0.4050\ffmpeg.exe'
$AllowedTitle = 'DOMGuard hidden-text demo (test data only) - Google Chrome'
$Download = Join-Path $env:USERPROFILE 'Downloads\DOMGuard-demo.mp4'
$StopFile = Join-Path $OutDir 'STOP'
$LogFile = Join-Path $OutDir 'record.log'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Remove-Item -Force $StopFile -ErrorAction SilentlyContinue

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DemoRecordNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, int extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, int extra);
    public static string TitleOf(IntPtr hWnd) {
        var title = new StringBuilder(300);
        GetWindowText(hWnd, title, title.Capacity);
        return title.ToString();
    }
}
'@

function Write-Log([string]$Action) {
    $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $Action
    Add-Content -Path $LogFile -Value $line -Encoding utf8
    Write-Output $line
}

function Test-DemoFront {
    $foreground = [DemoRecordNative]::GetForegroundWindow()
    return ([DemoRecordNative]::TitleOf($foreground) -eq $AllowedTitle)
}

[void][DemoRecordNative]::SetProcessDPIAware()
& (Join-Path $PSScriptRoot 'demo-place-window.ps1') | Out-Null
Start-Sleep -Milliseconds 250
if (-not (Test-DemoFront)) {
    Write-Log 'abort-foreground'
    exit 2
}
$foreground = [DemoRecordNative]::GetForegroundWindow()
$rect = New-Object DemoRecordNative+RECT
[void][DemoRecordNative]::GetWindowRect($foreground, [ref]$rect)
$left = $rect.Left
$top = $rect.Top
$width = ($rect.Right - $rect.Left) - (($rect.Right - $rect.Left) % 2)
$height = ($rect.Bottom - $rect.Top) - (($rect.Bottom - $rect.Top) % 2)
if ($left -lt 0 -or $top -lt 0 -or $width -lt 400 -or $height -lt 300) {
    Write-Log 'abort-rect'
    exit 2
}

# Reset the demo window zoom to 100% before the take.
[DemoRecordNative]::keybd_event(0x11, 0, 0, 0)
[DemoRecordNative]::keybd_event(0x30, 0, 0, 0)
[DemoRecordNative]::keybd_event(0x30, 0, 2, 0)
[DemoRecordNative]::keybd_event(0x11, 0, 2, 0)
Start-Sleep -Milliseconds 200

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $Ffmpeg
$psi.Arguments = "-y -f gdigrab -framerate 60 -offset_x $left -offset_y $top -video_size ${width}x${height} -draw_mouse 1 -i desktop -c:v libx264 -preset veryfast -crf 16 -pix_fmt yuv420p `"$Download`""
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.CreateNoWindow = $true
$process = [System.Diagnostics.Process]::Start($psi)
Write-Log 'record-start'
Start-Sleep -Seconds 2
if (-not (Test-DemoFront)) {
    $process.StandardInput.WriteLine('q')
    $process.WaitForExit(8000) | Out-Null
    Write-Log 'abort-foreground'
    exit 2
}
$targetX = $left + 822
$targetY = $top + 68
$point = New-Object DemoRecordNative+POINT
[void][DemoRecordNative]::GetCursorPos([ref]$point)
$steps = 36
for ($i = 1; $i -le $steps; $i++) {
    $t = $i / $steps
    $eased = $t * $t * (3 - 2 * $t)
    $x = [int]($point.X + ($targetX - $point.X) * $eased)
    $y = [int]($point.Y + ($targetY - $point.Y) * $eased)
    if ($x -le 0 -and $y -le 0) {
        $process.StandardInput.WriteLine('q')
        Write-Log 'abort-corner'
        exit 2
    }
    [void][DemoRecordNative]::SetCursorPos($x, $y)
    Start-Sleep -Milliseconds 8
}
if (-not (Test-DemoFront)) {
    $process.StandardInput.WriteLine('q')
    $process.WaitForExit(8000) | Out-Null
    Write-Log 'abort-foreground'
    exit 2
}
[DemoRecordNative]::mouse_event(0x0002, 0, 0, 0, 0)
Start-Sleep -Milliseconds 40
[DemoRecordNative]::mouse_event(0x0004, 0, 0, 0, 0)
Write-Log 'click-toolbar-icon'
$deadline = (Get-Date).AddSeconds(70)
while ((Get-Date) -lt $deadline) {
    if (Test-Path $StopFile) { break }
    $cursor = New-Object DemoRecordNative+POINT
    [void][DemoRecordNative]::GetCursorPos([ref]$cursor)
    if ($cursor.X -le 0 -and $cursor.Y -le 0) {
        Write-Log 'abort-corner'
        break
    }
    Start-Sleep -Milliseconds 200
}
$process.StandardInput.WriteLine('q')
$process.WaitForExit(15000) | Out-Null
Write-Log 'record-stop'
Write-Output $Download
