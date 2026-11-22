"""Drive a Windows game window for the in-game witness (development tool).

The mod's acceptance witness is the strip inside Deadlock, so the shop has to be
opened and an item hovered on this machine. This drives that: focus the window,
move the pointer, click, press a key, and hand off to the screenshot command in
`tools/game_shot.ps1`. It is a probe, not part of the addon, and it is not packed.

usage:
  python tools/drive.py focus
  python tools/drive.py shot
  python tools/drive.py move 960 540
  python tools/drive.py click 960 540 [--double]
  python tools/drive.py key b
  python tools/drive.py keydown shift
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import subprocess
import sys
import time

user32 = ctypes.WinDLL("user32", use_last_error=True)
INPUT_MOUSE = 0
INPUT_KEYBOARD = 1
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_ABSOLUTE = 0x8000
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
KEYEVENTF_KEYUP = 0x0002

KEYS = {
    "b": 0x42, "escape": 0x1B, "enter": 0x0D, "space": 0x20, "tab": 0x09,
    "shift": 0x10, "ctrl": 0x11, "alt": 0x12, "f1": 0x70, "f8": 0x77,
}


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wt.LONG), ("dy", wt.LONG), ("mouseData", wt.DWORD),
                ("dwFlags", wt.DWORD), ("time", wt.DWORD), ("dwExtraInfo", ctypes.c_void_p)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wt.WORD), ("wScan", wt.WORD), ("dwFlags", wt.DWORD),
                ("time", wt.DWORD), ("dwExtraInfo", ctypes.c_void_p)]


class _INPUT(ctypes.Structure):
    class _U(ctypes.Union):
        _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]
    _anonymous_ = ("u",)
    _fields_ = [("type", wt.DWORD), ("u", _U)]


def _send(*inputs: _INPUT) -> None:
    array = (_INPUT * len(inputs))(*inputs)
    user32.SendInput(len(inputs), array, ctypes.sizeof(_INPUT))


def _mouse(flags: int, x: int = 0, y: int = 0) -> _INPUT:
    item = _INPUT()
    item.type = INPUT_MOUSE
    item.mi = MOUSEINPUT(x, y, 0, flags, 0, None)
    return item


def _key(vk: int, up: bool) -> _INPUT:
    item = _INPUT()
    item.type = INPUT_KEYBOARD
    item.ki = KEYBDINPUT(vk, 0, KEYEVENTF_KEYUP if up else 0, 0, None)
    return item


def focus() -> int:
    """Focus the game window; returns the window handle."""
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "$p = Get-Process deadlock -ErrorAction Stop | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1;"
         "$p.MainWindowHandle"],
        capture_output=True, text=True)
    handle = int((result.stdout or "0").strip() or 0)
    if not handle:
        raise SystemExit("REFUSED: no Deadlock window with a handle; is the game running?")
    user32.ShowWindow(handle, 9)  # SW_RESTORE
    user32.BringWindowToTop(handle)
    # Windows refuses SetForegroundWindow to a process that does not own the
    # current foreground window (the launch from the Steam URL leaves Freebuff in
    # front). Tapping ALT first is the documented unlock; without it the keys go
    # to whatever window still has focus.
    VK_MENU = 0x12
    KEYEVENTF_KEYUP = 0x0002
    user32.keybd_event(VK_MENU, 0, 0, 0)
    user32.SetForegroundWindow(handle)
    user32.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
    time.sleep(0.4)
    active = user32.GetForegroundWindow()
    if active != handle:
        raise SystemExit(f"REFUSED: focus stayed on window {active}, not Deadlock {handle}")
    return handle


def shot(path: str = "data/shots/screen.jpg") -> None:
    """Capture the desktop, downscaled, as a JPEG.

    This runs the capture inline: a .ps1 file with screen capture in it is blocked
    by this machine's antivirus as malicious content, while the same calls through
    -Command are not. A JPEG at 1280 wide stays under the size a viewer will take.
    """
    target = path.replace("\\", "\\\\")
    script = (
        "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;"
        "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;"
        "$f=New-Object System.Drawing.Bitmap $b.Width,$b.Height;"
        "$g=[System.Drawing.Graphics]::FromImage($f);"
        "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size);$g.Dispose();"
        "$h=[int]($b.Height*1280/$b.Width);"
        "$s=New-Object System.Drawing.Bitmap 1280,$h;"
        "$r=[System.Drawing.Graphics]::FromImage($s);"
        "$r.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;"
        "$r.DrawImage($f,0,0,1280,$h);$r.Dispose();"
        f"$s.Save('{target}',[System.Drawing.Imaging.ImageFormat]::Jpeg);"
        "$s.Dispose();$f.Dispose()"
    )
    folder = path.rsplit("/", 1)[0]
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    f"New-Item -ItemType Directory -Force -Path '{folder}' | Out-Null; {script}"],
                   check=True)


def move(x: int, y: int) -> None:
    width = user32.GetSystemMetrics(0)
    height = user32.GetSystemMetrics(1)
    _send(_mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
                 int(x * 65535 / max(width - 1, 1)), int(y * 65535 / max(height - 1, 1))))
    time.sleep(0.05)


def click(x: int, y: int, double: bool = False) -> None:
    move(x, y)
    for _ in range(2 if double else 1):
        _send(_mouse(MOUSEEVENTF_LEFTDOWN), _mouse(MOUSEEVENTF_LEFTUP))
        time.sleep(0.08 if double else 0.2)


def key(name: str, hold: float = 0.06, up_only: bool = False) -> None:
    vk = KEYS.get(name.lower())
    if vk is None and len(name) == 1 and name.isalpha():
        vk = ord(name.upper())
    if vk is None:
        raise SystemExit(f"REFUSED: no virtual-key mapping for {name}")
    if not up_only:
        _send(_key(vk, False))
        time.sleep(hold)
    _send(_key(vk, True))


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    command = argv[0]
    if command == "focus":
        print(f"focused window {focus()}")
    elif command == "shot":
        focus()
        shot(argv[1] if len(argv) > 1 else "data/shots/screen.jpg")
        print("shot written")
    elif command == "move":
        focus()
        move(int(argv[1]), int(argv[2]))
    elif command == "click":
        focus()
        click(int(argv[1]), int(argv[2]), "--double" in argv)
    elif command == "key":
        focus()
        key(argv[1])
    elif command == "keydown":
        focus()
        key(argv[1], up_only=False, hold=float(argv[2]) if len(argv) > 2 else 0.02)
    elif command == "keyup":
        focus()
        key(argv[1], up_only=True)
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
