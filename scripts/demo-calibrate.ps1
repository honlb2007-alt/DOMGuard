# Record cursor positions for the DOMGuard demo.
# The operator hovers in the demo Chrome window and presses F8.
# This script does not click, type into Chrome, or move the cursor.

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$AllowedTitle = 'DOMGuard hidden-text demo (test data only) - Google Chrome'
$OutDir = Join-Path $Root 'demo\out'
$OutFile = Join-Path $OutDir 'calibration.json'
$LogFile = Join-Path $OutDir 'calibrate.log'
$ItemLimitSec = 90
$RunLimitSec = 8 * 60

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class DemoCalibrateNative {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

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
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    [DllImport("shcore.dll")]
    public static extern int GetScaleFactorForMonitor(IntPtr hmonitor, out int scale);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);

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
            rows.Add(pid + "\t" + hWnd.ToInt64() + "\t" + title.ToString());
            return true;
        }, IntPtr.Zero);
        return rows;
    }
}
'@

function Write-Log {
    param([string]$Action)
    $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $Action
    Add-Content -Path $LogFile -Value $line -Encoding utf8
    Write-Output $line
}

function Get-AllowedWindowIds {
    $ids = @{}
    foreach ($row in [DemoCalibrateNative]::VisibleChromeWindows()) {
        $parts = $row.Split("`t", 3)
        if ($parts.Length -ge 3 -and $parts[2] -eq $AllowedTitle) {
            $ids[$parts[1]] = $true
        }
    }
    return $ids
}

function Test-DemoForeground {
    $foreground = [DemoCalibrateNative]::GetForegroundWindow()
    $title = New-Object System.Text.StringBuilder 300
    [void][DemoCalibrateNative]::GetWindowText($foreground, $title, $title.Capacity)
    return ($title.ToString() -eq $AllowedTitle)
}

function Get-Pointer {
    $point = New-Object DemoCalibrateNative+POINT
    [void][DemoCalibrateNative]::GetCursorPos([ref]$point)
    return $point
}

function Test-CornerStop {
    $point = Get-Pointer
    return ($point.X -le 0 -and $point.Y -le 0)
}

function Test-KeyDown {
    param([int]$VirtualKey)
    return (([DemoCalibrateNative]::GetAsyncKeyState($VirtualKey) -band 0x8000) -ne 0)
}

function Wait-KeyRelease {
    param([int]$VirtualKey)
    while (Test-KeyDown $VirtualKey) {
        if (Test-CornerStop) {
            throw 'STOP_CORNER'
        }
        Start-Sleep -Milliseconds 30
    }
}

# F7 skip, F8 capture, F9 confirm, F10 redo, Escape abort.
$KeySkip = 0x76
$KeyCapture = 0x77
$KeyConfirm = 0x78
$KeyRedo = 0x79
$KeyAbort = 0x1B

function Wait-CalibrationKey {
    param([datetime]$Deadline)
    while ((Get-Date) -lt $Deadline) {
        if (Test-CornerStop) {
            return 'corner'
        }
        if (-not (Test-DemoForeground)) {
            Start-Sleep -Milliseconds 30
            continue
        }
        foreach ($pair in @(
            @{ Name = 'skip'; Key = $KeySkip },
            @{ Name = 'capture'; Key = $KeyCapture },
            @{ Name = 'confirm'; Key = $KeyConfirm },
            @{ Name = 'redo'; Key = $KeyRedo },
            @{ Name = 'abort'; Key = $KeyAbort }
        )) {
            if (Test-KeyDown $pair.Key) {
                Wait-KeyRelease $pair.Key
                return $pair.Name
            }
        }
        Start-Sleep -Milliseconds 30
    }
    return 'timeout'
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Write-Log 'calibrate-start'

$windowIds = Get-AllowedWindowIds
if ($windowIds.Count -ne 1) {
    Write-Log 'abort-no-demo-window'
    Write-Output 'STOP. The DOMGuard hidden-text demo window was not found exactly once. No other Chrome window will be used.'
    exit 2
}
if (-not (Test-DemoForeground)) {
    Write-Log 'wait-foreground'
    Write-Output 'The DOMGuard demo window is not in front. Keys are ignored until it is. Click that window, then press F8.'
}

$items = @(
    @{ Id = 'toolbarIcon'; Prompt = 'Start by opening DOMGuard. Hover its toolbar icon, then press F8.'; Optional = $false },
    @{ Id = 'protectAllSwitch'; Prompt = 'Open the DOMGuard popup yourself. Hover the Protect all sites switch, then press F8.'; Optional = $false },
    @{ Id = 'showHiddenText'; Prompt = 'Hover the Show Hidden Text button, then press F8.'; Optional = $false },
    @{ Id = 'maskSensitive'; Prompt = 'Hover the Mask sensitive data switch, then press F8. Press F7 if that switch is not in the popup.'; Optional = $true },
    @{ Id = 'articleCenter'; Prompt = 'On stage.html, hover the center of the article area, then press F8.'; Optional = $false },
    @{ Id = 'settingsCard'; Prompt = 'Hover the fake-key row in the settings card, then press F8.'; Optional = $false },
    @{ Id = 'feedCenter'; Prompt = 'Hover the center of the scrolling feed, then press F8.'; Optional = $false },
    @{ Id = 'dragStart'; Prompt = 'Hover the drag-capture start point, then press F8.'; Optional = $false },
    @{ Id = 'dragEnd'; Prompt = 'Hover the drag-capture end point, then press F8.'; Optional = $false },
    @{ Id = 'pasteCenter'; Prompt = 'Hover the center of the paste area, then press F8.'; Optional = $false }
)

$origin = New-Object DemoCalibrateNative+POINT
$origin.X = 0
$origin.Y = 0
$monitor = [DemoCalibrateNative]::MonitorFromPoint($origin, 2)
$scaleFactor = 0
[void][DemoCalibrateNative]::GetScaleFactorForMonitor($monitor, [ref]$scaleFactor)
$points = [ordered]@{}
$started = Get-Date
Write-Output 'Leave focus in the demo Chrome window. F8 captures, F9 confirms, F10 recaptures, Escape aborts.'
Write-Output 'Move the pointer to the top-left corner to stop immediately.'
Write-Output 'Do not click this terminal.'

try {
    foreach ($item in $items) {
        if (((Get-Date) - $started).TotalSeconds -ge $RunLimitSec) {
            Write-Log 'abort-run-limit'
            Write-Output 'STOP. The 8 minute run limit was reached.'
            break
        }
        $captured = $null
        $accepted = $false
        $itemStarted = Get-Date
        Write-Output ''
        Write-Output $item.Prompt
        Write-Log ("prompt-" + $item.Id)
        while (-not $accepted) {
            $remaining = $ItemLimitSec - ((Get-Date) - $itemStarted).TotalSeconds
            if ($remaining -le 0 -or ((Get-Date) - $started).TotalSeconds -ge $RunLimitSec) {
                Write-Log ("timeout-" + $item.Id)
                Write-Output ("STOP. Timed out while waiting for {0}." -f $item.Id)
                $accepted = $true
                $captured = $null
                break
            }
            $deadline = (Get-Date).AddSeconds([Math]::Min($remaining, 5))
            $key = Wait-CalibrationKey $deadline
            if ($key -eq 'timeout') {
                continue
            }
            if ($key -eq 'corner') {
                throw 'STOP_CORNER'
            }
            if ($key -eq 'foreground') {
                Write-Log 'abort-foreground'
                Write-Output 'STOP. The foreground window is no longer the demo Chrome window.'
                $accepted = $true
                $captured = $null
                break
            }
            if ($key -eq 'abort') {
                Write-Log 'abort-escape'
                Write-Output 'STOP. Escape was pressed.'
                $accepted = $true
                $captured = $null
                break
            }
            if ($key -eq 'skip') {
                if ($item.Optional) {
                    Write-Log ("skip-" + $item.Id)
                    Write-Output ("Skipped {0}." -f $item.Id)
                    $accepted = $true
                    $captured = $null
                    break
                }
                Write-Output 'F7 skips only the optional Mask sensitive data switch.'
                continue
            }
            if ($key -eq 'capture' -or $key -eq 'redo') {
                $pointer = Get-Pointer
                $captured = @{ x = $pointer.X; y = $pointer.Y }
                Write-Log ("capture-" + $item.Id)
                Write-Output ("Captured {0} at ({1}, {2}). Press F9 to confirm, or F10 to recapture." -f $item.Id, $pointer.X, $pointer.Y)
                continue
            }
            if ($key -eq 'confirm') {
                if ($null -eq $captured) {
                    Write-Output 'Press F8 on the target before F9.'
                    continue
                }
                $points[$item.Id] = @{
                    x = $captured.x
                    y = $captured.y
                    confirmedAt = (Get-Date).ToString('o')
                }
                Write-Log ("confirm-" + $item.Id)
                Write-Output ("Confirmed {0}." -f $item.Id)
                $accepted = $true
            }
        }
        if ($null -eq $captured -and -not $points.Contains($item.Id) -and $item.Id -ne 'maskSensitive') {
            break
        }
    }
} catch {
    if ($_.Exception.Message -eq 'STOP_CORNER' -or $_ -eq 'STOP_CORNER') {
        Write-Log 'abort-corner'
        Write-Output 'STOP. The pointer reached the top-left corner.'
    } else {
        Write-Log 'abort-error'
        throw
    }
}

$record = [ordered]@{
    version = 1
    capturedAt = (Get-Date).ToString('o')
    displayScalePercent = $scaleFactor
    coordinateSpace = 'GetCursorPos from a process without per-monitor DPI awareness'
    points = $points
}
$record | ConvertTo-Json -Depth 5 | Set-Content -Path $OutFile -Encoding utf8
Write-Log 'calibrate-saved'
Write-Output ''
Write-Output ("Saved {0}" -f $OutFile)
Write-Output ("Confirmed points: {0}" -f $points.Count)
