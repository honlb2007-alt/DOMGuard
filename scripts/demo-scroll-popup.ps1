# Scroll the open DOMGuard popup. Does nothing if the demo page is not in front.
$ErrorActionPreference = 'Stop'
$AllowedTitle = 'DOMGuard hidden-text demo (test data only) - Google Chrome'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DemoScrollNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, int extra);
    public static string TitleOf(IntPtr hWnd) {
        var title = new StringBuilder(300);
        GetWindowText(hWnd, title, title.Capacity);
        return title.ToString();
    }
}
'@
[void][DemoScrollNative]::SetProcessDPIAware()
$foreground = [DemoScrollNative]::GetForegroundWindow()
$title = [DemoScrollNative]::TitleOf($foreground)
if ($title -ne $AllowedTitle) {
    Write-Output 'STOP foreground'
    exit 2
}
[void][DemoScrollNative]::SetCursorPos(700, 440)
Start-Sleep -Milliseconds 150
for ($i = 0; $i -lt 5; $i++) {
    [DemoScrollNative]::mouse_event(0x0800, 0, 0, -120, 0)
    Start-Sleep -Milliseconds 180
}
Write-Output 'scrolled'
