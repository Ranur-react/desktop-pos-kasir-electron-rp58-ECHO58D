const { spawnSync } = require("child_process");

function runPowerShell(command) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10
    }
  );
}

function escapeSingleQuotes(value) {
  return String(value || "").replace(/'/g, "''");
}

function getPrinters() {
  const result = runPowerShell(
    "Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress"
  );

  if (result.status !== 0) {
    return [];
  }

  const raw = (result.stdout || "").trim();
  if (!raw) {
    return [];
  }

  let names;
  try {
    names = JSON.parse(raw);
  } catch {
    return [];
  }

  const list = Array.isArray(names) ? names : [names];
  return list.map((name) => ({
    name,
    status: "ONLINE",
    attributes: []
  }));
}

function getPrinter(printerName) {
  const safeName = escapeSingleQuotes(printerName);
  const result = runPowerShell(
    `if (Get-Printer -Name '${safeName}' -ErrorAction SilentlyContinue) { Write-Output 'FOUND' } else { Write-Output 'NOT_FOUND' }`
  );

  const output = (result.stdout || "").trim();
  if (output !== "FOUND") {
    return null;
  }

  return {
    name: printerName,
    status: "ONLINE",
    attributes: []
  };
}

function printDirect({ data, printer, success, error }) {
  try {
    const payloadBase64 = Buffer.from(data).toString("base64");
    const safePrinter = escapeSingleQuotes(printer);

    const script = `
$printerName = '${safePrinter}'
$payloadB64 = '${payloadBase64}'

$code = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFOA
  {
    [MarshalAs(UnmanagedType.LPStr)]
    public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)]
    public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)]
    public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

  public static bool SendBytesToPrinter(string szPrinterName, byte[] pBytes)
  {
    IntPtr hPrinter;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "POS Thermal Receipt";
    di.pDataType = "RAW";

    if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) return false;

    bool ok = false;
    if (StartDocPrinter(hPrinter, 1, di))
    {
      if (StartPagePrinter(hPrinter))
      {
        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(pBytes.Length);
        Marshal.Copy(pBytes, 0, pUnmanagedBytes, pBytes.Length);
        int dwWritten = 0;
        ok = WritePrinter(hPrinter, pUnmanagedBytes, pBytes.Length, out dwWritten);
        Marshal.FreeCoTaskMem(pUnmanagedBytes);
        EndPagePrinter(hPrinter);
      }
      EndDocPrinter(hPrinter);
    }

    ClosePrinter(hPrinter);
    return ok;
  }
}
"@

Add-Type -TypeDefinition $code -Language CSharp | Out-Null
$bytes = [Convert]::FromBase64String($payloadB64)
$ok = [RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes)
if (-not $ok) {
  throw "WritePrinter RAW gagal."
}
Write-Output "OK"
`;

    const result = runPowerShell(script);

    if (result.status !== 0) {
      const stderr = (result.stderr || "").trim();
      const stdout = (result.stdout || "").trim();
      throw new Error(stderr || stdout || "PowerShell RAW print gagal.");
    }

    if (typeof success === "function") {
      success(`Printed via Winspool RAW: ${printer}`);
    }
  } catch (err) {
    if (typeof error === "function") {
      error(err);
    }
  }
}

module.exports = {
  getPrinters,
  getPrinter,
  printDirect
};
