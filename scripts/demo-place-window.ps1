# Place the single-tab demo window at a normal size. Does not touch other titles.
$ErrorActionPreference = 'Stop'
$AllowedTitle = 'DOMGuard hidden-text demo (test data only) - Google Chrome'

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class DemoPlaceNative {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    public static List<string> Matches(string allowed) {
        var rows = new List<string>();
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            var className = new StringBuilder(256);
            GetClassName(hWnd, className, className.Capacity);
            if (className.ToString() != "Chrome_WidgetWin_1") return true;
            var title = new StringBuilder(300);
            GetWindowText(hWnd, title, title.Capacity);
            if (title.ToString() != allowed) return true;
            RECT rect;
            GetWindowRect(hWnd, out rect);
            int width = rect.Right - rect.Left;
            int height = rect.Bottom - rect.Top;
            rows.Add(hWnd.ToInt64() + "\t" + rect.Left + "," + rect.Top + "\t" + width + "x" + height);
            return true;
        }, IntPtr.Zero);
        return rows;
    }
    public static string TitleOf(IntPtr hWnd) {
        var title = new StringBuilder(300);
        GetWindowText(hWnd, title, title.Capacity);
        return title.ToString();
    }
}
'@

[void][DemoPlaceNative]::SetProcessDPIAware()
$rows = @([DemoPlaceNative]::Matches($AllowedTitle))
Write-Output ("count=" + $rows.Count)
$rows | ForEach-Object { Write-Output $_ }
if ($rows.Count -lt 1) { exit 2 }
$first = ($rows | Select-Object -First 1).Split("`t")
$handle = [IntPtr][int64]$first[0]
[void][DemoPlaceNative]::ShowWindow($handle, 9)
[void][DemoPlaceNative]::SetWindowPos($handle, [IntPtr]::Zero, 80, 40, 1280, 800, 0x0040)
[void][DemoPlaceNative]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds 400
$foreground = [DemoPlaceNative]::GetForegroundWindow()
$matched = [DemoPlaceNative]::TitleOf($foreground) -eq $AllowedTitle
Write-Output ("foregroundMatch=" + $matched)
$rows2 = @([DemoPlaceNative]::Matches($AllowedTitle))
$rows2 | ForEach-Object { Write-Output ("now " + $_) }
if (-not $matched) { exit 2 }
