param([Parameter(Mandatory=$true)][string]$Java,
      [Parameter(Mandatory=$true)][string]$ArgumentFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class HiddenExportProcess {
  private delegate bool WindowVisitor(IntPtr window, IntPtr context);
  [DllImport("user32.dll")] private static extern bool EnumWindows(WindowVisitor visitor, IntPtr context);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
  // Windows CommandLineToArgvW quoting, not PowerShell/shell interpolation.
  private static string Quote(string value) {
    var result = new StringBuilder("\""); int slashes = 0;
    foreach (char character in value) {
      if (character == '\\') { slashes++; continue; }
      if (character == '"') result.Append('\\', slashes * 2 + 1);
      else result.Append('\\', slashes);
      result.Append(character); slashes = 0;
    }
    result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
  }
  public static int Run(string java, string[] args) {
    var quoted = Array.ConvertAll(args, Quote);
    var start = new ProcessStartInfo(java, string.Join(" ", quoted)) {
      UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
      RedirectStandardOutput = true, RedirectStandardError = true,
      StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
    };
    using (var process = new Process { StartInfo = start }) {
      process.OutputDataReceived += (sender, line) => { if (line.Data != null) Console.Out.WriteLine(line.Data); };
      process.ErrorDataReceived += (sender, line) => { if (line.Data != null) Console.Error.WriteLine(line.Data); };
      process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
      int hidden = 0;
      WindowVisitor visitor = (window, context) => {
        uint owner; GetWindowThreadProcessId(window, out owner);
        if (owner == process.Id && IsWindowVisible(window)) { ShowWindowAsync(window, 0); hidden++; }
        return true;
      };
      Console.WriteLine("Hidden export renderer PID: " + process.Id);
      while (!process.WaitForExit(25)) EnumWindows(visitor, IntPtr.Zero);
      process.WaitForExit(); // Drain asynchronous output before returning its real exit status.
      Console.WriteLine("Exporter windows hidden: " + hidden);
      GC.KeepAlive(visitor);
      return process.ExitCode;
    }
  }
}
'@
$jvmArguments = [string[]](ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($ArgumentFile)))
exit [HiddenExportProcess]::Run($Java, $jvmArguments)
