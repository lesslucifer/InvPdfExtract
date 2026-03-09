"use strict";

/**
 * Windows GUI dialogs via PowerShell + file open helper.
 * All execSync / shell side-effects are contained here.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

/**
 * Run a PowerShell script and return its stdout as a string.
 * Output is captured via a UTF-8 temp file to avoid console pipe encoding issues.
 */
function runPowerShell(script) {
  const tmpFileName = `ps_out_${process.pid}.txt`; // ASCII-only, safe in PS single-quoted string
  const tmpFile = path.join(os.tmpdir(), tmpFileName);
  const wrapper = [
    `$__f = Join-Path $env:TEMP '${tmpFileName}'`,
    `$__r = (& {`,
    script,
    `}) -join [System.Environment]::NewLine`,
    `if ($__r) { [System.IO.File]::WriteAllText($__f, $__r, [System.Text.Encoding]::UTF8) }`,
  ].join("\n");
  const encoded = Buffer.from(wrapper, "utf16le").toString("base64");
  try {
    execSync(`powershell -NoProfile -STA -EncodedCommand ${encoded}`, { stdio: "ignore" });
  } catch {}
  try {
    if (fs.existsSync(tmpFile)) {
      const result = fs.readFileSync(tmpFile, "utf8").trim();
      fs.unlinkSync(tmpFile);
      return result;
    }
  } catch {}
  return "";
}

/**
 * Show a modern Windows folder picker dialog.
 * Returns the selected folder path, or "" if cancelled.
 */
function browseFolderDialog(description) {
  return runPowerShell(`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class ModernFolderPicker {
    [ComImport, ClassInterface(ClassInterfaceType.None)]
    [Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    private class FileOpenDialogClass {}

    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint c, IntPtr specs);
        void SetFileTypeIndex(uint i);
        void GetFileTypeIndex(out uint i);
        void Advise(IntPtr pfde, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint fos);
        void GetOptions(out uint fos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, uint fdap);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string ext);
        void Close([MarshalAs(UnmanagedType.Error)] int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
        void GetAttributes(uint mask, out uint attribs);
        void Compare(IShellItem psi, uint hint, out int order);
    }

    public static string PickFolder(string title) {
        var dialog = (IFileDialog)new FileOpenDialogClass();
        dialog.SetOptions(0x20 | 0x40); // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM
        dialog.SetTitle(title);
        if (dialog.Show(IntPtr.Zero) != 0) return null;
        IShellItem item;
        dialog.GetResult(out item);
        string path;
        item.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
        return path;
    }
}
'@ -Language CSharp

$result = [ModernFolderPicker]::PickFolder("${description}")
if ($result) { Write-Output $result }
`);
}

/**
 * Show a Windows Save As dialog filtered to .xlsx files.
 * Returns the chosen file path, or "" if cancelled.
 */
function savFileDialog(initialDir, defaultName) {
  return runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Filter = "Excel Files (*.xlsx)|*.xlsx"
$d.FileName = "${defaultName}"
$d.InitialDirectory = "${initialDir.replace(/\\/g, "\\\\")}"
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $d.FileName
}
`);
}

/**
 * Open a file with the system default application (Windows only).
 */
function openFile(filePath) {
  try {
    execSync(`start "" "${filePath}"`, { shell: true, stdio: "ignore" });
    console.log(`\nOpening file...`);
  } catch (err) {
    console.warn(`Could not open file automatically: ${err.message}`);
  }
}

module.exports = { runPowerShell, browseFolderDialog, savFileDialog, openFile };
