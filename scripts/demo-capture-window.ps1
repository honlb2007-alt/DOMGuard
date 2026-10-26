# Screenshot only the focused DOMGuard demo window, in physical pixels.
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'demo-place-window.ps1')
$Root = Split-Path -Parent $PSScriptRoot
$OutDir = Join-Path $Root 'demo\out\checks'
$AllowedTitle = 'DOMGuard hidden-text demo (test data only) - Google Chrome'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DemoShotNative {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    public static IntPtr FindForeground(string allowed) {
        IntPtr foreground = GetForegroundWindow();
        var title = new StringBuilder(300);
        GetWindowText(foreground, title, title.Capacity);
        if (title.ToString() != allowed) return IntPtr.Zero;
        return foreground;
    }
}
'@
[void][DemoShotNative]::SetProcessDPIAware()
$window = [DemoShotNative]::FindForeground($AllowedTitle)
if ($window -eq [IntPtr]::Zero) {
    Write-Output 'STOP foreground'
    exit 2
}
$rect = New-Object DemoShotNative+RECT
[void][DemoShotNative]::GetWindowRect($window, [ref]$rect)
$left = $rect.Left
$top = $rect.Top
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($left -lt 0 -or $top -lt 0 -or $width -lt 400 -or $height -lt 300) {
    Write-Output 'STOP rect'
    exit 2
}
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)
$graphics.Dispose()
$path = Join-Path $OutDir 'window.png'
$bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
Write-Output ("saved " + $left + "," + $top + " " + $width + "x" + $height + " " + $path)
