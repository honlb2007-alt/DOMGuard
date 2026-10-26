# Read-only preflight for the DOMGuard demo recording.
# Does not move the cursor, send keys, or open any application.

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$ProfileDir = Join-Path $Root 'demo\chrome-profile'
$StageUrl = 'http://localhost:4173/stage.html'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class DemoPreflightNative {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);

    [DllImport("shcore.dll")]
    public static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);

    [DllImport("shcore.dll")]
    public static extern int GetScaleFactorForMonitor(IntPtr hmonitor, out int scale);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmDeviceName;
        public short dmSpecVersion;
        public short dmDriverVersion;
        public short dmSize;
        public short dmDriverExtra;
        public int dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public int dmDisplayOrientation;
        public int dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel;
        public int dmPelsWidth;
        public int dmPelsHeight;
        public int dmDisplayFlags;
        public int dmDisplayFrequency;
        public int dmICMMethod;
        public int dmICMIntent;
        public int dmMediaType;
        public int dmDitherType;
        public int dmReserved1;
        public int dmReserved2;
        public int dmPanningWidth;
        public int dmPanningHeight;
    }

    [DllImport("user32.dll", CharSet = CharSet.Ansi)]
    public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

    public static List<string> VisibleChromeWindows() {
        var rows = new List<string>();
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) {
                return true;
            }
            var className = new StringBuilder(256);
            GetClassName(hWnd, className, className.Capacity);
            if (className.ToString() != "Chrome_WidgetWin_1") {
                return true;
            }
            var title = new StringBuilder(512);
            GetWindowText(hWnd, title, title.Capacity);
            if (title.Length == 0) {
                return true;
            }
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            RECT rect;
            GetWindowRect(hWnd, out rect);
            rows.Add(pid + "\t" + hWnd.ToInt64() + "\t" + rect.Left + "\t" + rect.Top + "\t" + rect.Right + "\t" + rect.Bottom + "\t" + title.ToString().Replace("\t", " "));
            return true;
        }, IntPtr.Zero);
        return rows;
    }
}
'@

function Write-Check {
    param([string]$Name, [string]$Detail)
    Write-Output ("{0}: {1}" -f $Name, $Detail)
}

Write-Output 'DOMGuard demo preflight'
Write-Output ''

$point = New-Object DemoPreflightNative+POINT
$point.X = 0
$point.Y = 0
$monitor = [DemoPreflightNative]::MonitorFromPoint($point, 2)
$dpiX = [uint32]0
$dpiY = [uint32]0
[void][DemoPreflightNative]::GetDpiForMonitor($monitor, 0, [ref]$dpiX, [ref]$dpiY)
$scaleFactor = 0
[void][DemoPreflightNative]::GetScaleFactorForMonitor($monitor, [ref]$scaleFactor)
Add-Type -AssemblyName System.Windows.Forms
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$mode = New-Object DemoPreflightNative+DEVMODE
$mode.dmSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mode)
[void][DemoPreflightNative]::EnumDisplaySettings($null, -1, [ref]$mode)
$physicalWidth = $mode.dmPelsWidth
$physicalHeight = $mode.dmPelsHeight
if ($physicalWidth -le 0 -or $physicalHeight -le 0) {
    $controller = Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution -gt 0 } | Select-Object -First 1
    if ($controller) {
        $physicalWidth = [int]$controller.CurrentHorizontalResolution
        $physicalHeight = [int]$controller.CurrentVerticalResolution
    }
}
$physicalScale = 100
if ($bounds.Width -gt 0 -and $physicalWidth -gt 0) {
    $physicalScale = [int][math]::Round(($physicalWidth / $bounds.Width) * 100)
}
$scale = $physicalScale
if ($scaleFactor -ge 100) {
    $scale = [Math]::Max($scale, $scaleFactor)
}
Write-Check 'Display' ("logical bounds {0}x{1} at ({2},{3}); current mode {4}x{5}; reported DPI {6}; scale factor {7}; inferred scale {8}%" -f $bounds.Width, $bounds.Height, $bounds.Left, $bounds.Top, $physicalWidth, $physicalHeight, $dpiX, $scaleFactor, $scale)
if ($scale -eq 100) {
    Write-Check 'Scale' 'OK at 100%'
} else {
    Write-Check 'Scale' 'NOT 100%. Open Settings, System, Display, Scale and layout, and choose 100%. Sign out of Windows or restart the demo Chrome after the change. This script will not change the scale.'
}

$demoPids = @{}
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | ForEach-Object {
    if ($_.CommandLine -and $_.CommandLine -like ("*{0}*" -f $ProfileDir)) {
        $demoPids[[uint32]$_.ProcessId] = $true
    }
}
Write-Check 'Demo profile processes' $demoPids.Count

$matches = @()
foreach ($row in [DemoPreflightNative]::VisibleChromeWindows()) {
    $parts = $row.Split("`t", 7)
    $processId = [uint32]$parts[0]
    if (-not $demoPids.ContainsKey($processId)) {
        continue
    }
    $matches += [pscustomobject]@{
        Pid = $processId
        Hwnd = $parts[1]
        Left = [int]$parts[2]
        Top = [int]$parts[3]
        Right = [int]$parts[4]
        Bottom = [int]$parts[5]
        Title = $parts[6]
    }
}

$foreground = [DemoPreflightNative]::GetForegroundWindow().ToInt64().ToString()
if ($matches.Count -eq 0) {
    Write-Check 'Demo Chrome window' 'NOT FOUND'
    Write-Output 'Open the demo profile yourself, without --load-extension. Place that window at the top-left of the primary display and size it to about 1920x1040 so the taskbar stays visible. Then open http://localhost:4173/stage.html in that window only.'
} else {
    $window = $matches | Sort-Object { ($_.Right - $_.Left) * ($_.Bottom - $_.Top) } -Descending | Select-Object -First 1
    $width = $window.Right - $window.Left
    $height = $window.Bottom - $window.Top
    Write-Check 'Demo Chrome window' ("hwnd {0}; rect ({1},{2})-({3},{4}); size {5}x{6}" -f $window.Hwnd, $window.Left, $window.Top, $window.Right, $window.Bottom, $width, $height)
    Write-Check 'Window title' $window.Title
    Write-Check 'Foreground' ($(if ($window.Hwnd -eq $foreground) { 'this demo window' } else { 'a different window is in front. Bring the demo Chrome window to the front before any later phase.' }))
    $positionOk = ($window.Left -eq 0 -and $window.Top -eq 0)
    $sizeOk = ([math]::Abs($width - 1920) -le 40 -and [math]::Abs($height - 1040) -le 40)
    if ($positionOk -and $sizeOk) {
        Write-Check 'Window placement' 'OK near (0,0) and about 1920x1040'
    } else {
        Write-Check 'Window placement' 'NOT at (0,0) with size about 1920x1040. Restore the demo window if it is maximized, then move it to the top-left of the primary display and resize it to about 1920x1040, leaving the taskbar visible. This script will not drag the window.'
    }
    if ($window.Title -like '*localhost:4173/stage.html*') {
        Write-Check 'Current page' $StageUrl
    } else {
        Write-Check 'Current page' ("UNCONFIRMED. The window title does not contain the address. Confirm the address bar shows {0} and nothing else." -f $StageUrl)
    }
}

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
    Write-Check 'ffmpeg' 'NOT FOUND. Install a static ffmpeg build that includes gdigrab, add it to PATH, and rerun this script. This script will not install it.'
} else {
    $versionLine = (& ffmpeg -version 2>&1 | Select-Object -First 1)
    Write-Check 'ffmpeg' ("{0} ({1})" -f $versionLine, $ffmpeg.Source)
    $devices = & ffmpeg -hide_banner -devices 2>&1 | Out-String
    if ($devices -match '(?m)^\s*D\s+gdigrab\s') {
        Write-Check 'gdigrab' 'available'
    } else {
        Write-Check 'gdigrab' 'NOT listed by ffmpeg -devices. Use an ffmpeg build with the gdigrab input device. This script will not install one.'
    }
}

Write-Check 'demo/stage.html' $(if (Test-Path (Join-Path $Root 'demo\stage.html')) { 'present' } else { 'MISSING' })
Write-Check 'demo/scenes.json' $(if (Test-Path (Join-Path $Root 'demo\scenes.json')) { 'present' } else { 'MISSING' })

Write-Output ''
Write-Output 'Confirm before any later phase: Do Not Disturb is on, no other application windows are open, and the Chrome bookmark bar is hidden.'
Write-Output 'The demo will later copy a screenshot of the demo page onto the clipboard.'
