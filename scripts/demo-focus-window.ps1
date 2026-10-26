# Bring the authorized demo window to the foreground. Does not click or type.
$ErrorActionPreference = 'Stop'
$AllowedTitle = 'DOMGuard hidden-text demo (test data only) - Google Chrome'

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DemoFocusNative {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    public static IntPtr Find(string allowed) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            var className = new StringBuilder(256);
            GetClassName(hWnd, className, className.Capacity);
            if (className.ToString() != "Chrome_WidgetWin_1") return true;
            var title = new StringBuilder(300);
            GetWindowText(hWnd, title, title.Capacity);
            if (title.ToString() == allowed) found = hWnd;
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static string TitleOf(IntPtr hWnd) {
        var title = new StringBuilder(300);
        GetWindowText(hWnd, title, title.Capacity);
        return title.ToString();
    }
}
'@

$window = [DemoFocusNative]::Find($AllowedTitle)
if ($window -eq [IntPtr]::Zero) {
    Write-Output 'missing'
    exit 2
}
$switched = [DemoFocusNative]::SetForegroundWindow($window)
Start-Sleep -Milliseconds 500
$foreground = [DemoFocusNative]::GetForegroundWindow()
$matched = $foreground -eq $window
Write-Output ("set=" + $switched + " foregroundMatch=" + $matched)
if (-not $matched) { exit 2 }
