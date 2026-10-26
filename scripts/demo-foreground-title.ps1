$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DemoFrontNative {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
    public static string Describe() {
        var hwnd = GetForegroundWindow();
        var title = new StringBuilder(300);
        var className = new StringBuilder(256);
        GetWindowText(hwnd, title, title.Capacity);
        GetClassName(hwnd, className, className.Capacity);
        return hwnd.ToInt64().ToString() + " | " + className.ToString() + " | " + title.ToString();
    }
}
'@
Write-Output ([DemoFrontNative]::Describe())
