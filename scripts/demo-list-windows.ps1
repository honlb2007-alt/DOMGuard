# Read-only list of visible Chrome window titles and rectangles.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class DemoListNative {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    public static List<string> Rows() {
        var rows = new List<string>();
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            var className = new StringBuilder(256);
            GetClassName(hWnd, className, className.Capacity);
            if (className.ToString() != "Chrome_WidgetWin_1") return true;
            var title = new StringBuilder(300);
            GetWindowText(hWnd, title, title.Capacity);
            if (title.Length == 0) return true;
            RECT rect;
            GetWindowRect(hWnd, out rect);
            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            int width = rect.Right - rect.Left;
            int height = rect.Bottom - rect.Top;
            rows.Add(processId.ToString() + "\t" + hWnd.ToInt64().ToString() + "\t" + rect.Left + "," + rect.Top + "\t" + width + "x" + height + "\t" + title.ToString());
            return true;
        }, IntPtr.Zero);
        return rows;
    }
}
'@

$foreground = [DemoListNative]::GetForegroundWindow().ToInt64()
Write-Output "foreground=$foreground"
[DemoListNative]::Rows() | ForEach-Object { Write-Output $_ }
