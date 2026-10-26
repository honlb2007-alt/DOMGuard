# Bring the demo window forward and test both gdigrab coordinate spaces.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$OutDir = Join-Path $Root 'demo\out\checks'
$Ffmpeg = 'C:\Users\lickb\AppData\Local\CapCut\Apps\9.5.0.4050\ffmpeg.exe'
$AllowedTitle = 'DOMGuard hidden-text demo (test data only) - Google Chrome'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DemoGrabNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
    public static string TitleOf(IntPtr hWnd) {
        var title = new StringBuilder(300);
        GetWindowText(hWnd, title, title.Capacity);
        return title.ToString();
    }
}
'@

[void][DemoGrabNative]::SetProcessDPIAware()
& (Join-Path $PSScriptRoot 'demo-place-window.ps1') | Out-Null
Start-Sleep -Milliseconds 300
$foreground = [DemoGrabNative]::GetForegroundWindow()
if ([DemoGrabNative]::TitleOf($foreground) -ne $AllowedTitle) {
    Write-Output 'STOP foreground'
    exit 2
}
$rect = New-Object DemoGrabNative+RECT
[void][DemoGrabNative]::GetWindowRect($foreground, [ref]$rect)
$left = $rect.Left
$top = $rect.Top
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$width = $width - ($width % 2)
$height = $height - ($height % 2)
Write-Output ("physical " + $left + "," + $top + " " + $width + "x" + $height)
& $Ffmpeg -y -hide_banner -loglevel error -f gdigrab -framerate 1 -offset_x $left -offset_y $top -video_size "${width}x${height}" -draw_mouse 0 -i desktop -frames:v 1 (Join-Path $OutDir 'grab-physical.png')
$scale = 1.25
$lx = [int][Math]::Round($left / $scale)
$ly = [int][Math]::Round($top / $scale)
$lw = [int][Math]::Round($width / $scale)
$lh = [int][Math]::Round($height / $scale)
$lw = $lw - ($lw % 2)
$lh = $lh - ($lh % 2)
Write-Output ("logical " + $lx + "," + $ly + " " + $lw + "x" + $lh)
& $Ffmpeg -y -hide_banner -loglevel error -f gdigrab -framerate 1 -offset_x $lx -offset_y $ly -video_size "${lw}x${lh}" -draw_mouse 0 -i desktop -frames:v 1 (Join-Path $OutDir 'grab-logical.png')
Write-Output 'grabbed'
