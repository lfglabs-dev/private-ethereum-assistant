<#
.SYNOPSIS
  Windows Credential Manager helper for secret storage.
  Uses advapi32.dll P/Invoke to manage CRED_TYPE_GENERIC credentials.

.DESCRIPTION
  Commands:
    credential-helper.ps1 set <service> <account>    # reads value from stdin
    credential-helper.ps1 get <service> <account>
    credential-helper.ps1 delete <service> <account>
    credential-helper.ps1 list <service>
    credential-helper.ps1 export <service>

  Exit codes:
    0 = success
    1 = item not found
    3 = general error
#>

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CredentialManager
{
    public const int CRED_TYPE_GENERIC = 1;
    public const int CRED_PERSIST_LOCAL_MACHINE = 2;
    public const int CRED_MAX_CREDENTIAL_BLOB_SIZE = 2560;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL
    {
        public uint Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredRead(string targetName, int type, int reservedFlag, out IntPtr credential);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredDelete(string targetName, int type, int flags);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredEnumerate(string filter, uint flags, out uint count, out IntPtr credentials);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern void CredFree(IntPtr buffer);

    public static void WriteCredential(string targetName, string secret)
    {
        byte[] byteArray = Encoding.Unicode.GetBytes(secret);
        if (byteArray.Length > CRED_MAX_CREDENTIAL_BLOB_SIZE)
            throw new ArgumentException("Secret exceeds maximum credential size.");

        CREDENTIAL cred = new CREDENTIAL();
        cred.Type = CRED_TYPE_GENERIC;
        cred.TargetName = targetName;
        cred.CredentialBlobSize = (uint)byteArray.Length;
        cred.CredentialBlob = Marshal.AllocHGlobal(byteArray.Length);
        cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
        cred.UserName = Environment.UserName;

        try
        {
            Marshal.Copy(byteArray, 0, cred.CredentialBlob, byteArray.Length);
            if (!CredWrite(ref cred, 0))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            Marshal.FreeHGlobal(cred.CredentialBlob);
        }
    }

    public static string ReadCredential(string targetName)
    {
        IntPtr credPtr;
        if (!CredRead(targetName, CRED_TYPE_GENERIC, 0, out credPtr))
        {
            int error = Marshal.GetLastWin32Error();
            if (error == 1168) // ERROR_NOT_FOUND
                return null;
            throw new System.ComponentModel.Win32Exception(error);
        }

        try
        {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
            byte[] bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, bytes.Length);
            return Encoding.Unicode.GetString(bytes);
        }
        finally
        {
            CredFree(credPtr);
        }
    }

    public static bool DeleteCredential(string targetName)
    {
        if (!CredDelete(targetName, CRED_TYPE_GENERIC, 0))
        {
            int error = Marshal.GetLastWin32Error();
            if (error == 1168) // ERROR_NOT_FOUND
                return false;
            throw new System.ComponentModel.Win32Exception(error);
        }
        return true;
    }

    public static string[] EnumerateCredentials(string filter)
    {
        uint count;
        IntPtr credPtr;
        if (!CredEnumerate(filter, 0, out count, out credPtr))
        {
            int error = Marshal.GetLastWin32Error();
            if (error == 1168) // ERROR_NOT_FOUND
                return new string[0];
            throw new System.ComponentModel.Win32Exception(error);
        }

        try
        {
            string[] results = new string[count];
            for (uint i = 0; i < count; i++)
            {
                IntPtr current = Marshal.ReadIntPtr(credPtr, (int)(i * IntPtr.Size));
                CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(current, typeof(CREDENTIAL));
                results[i] = cred.TargetName;
            }
            Array.Sort(results);
            return results;
        }
        finally
        {
            CredFree(credPtr);
        }
    }
}
"@

function Get-TargetName {
    param([string]$Service, [string]$Account)
    return "$Service/$Account"
}

function Get-FilterPattern {
    param([string]$Service)
    return "$Service/*"
}

function Get-AccountFromTargetName {
    param([string]$Service, [string]$TargetName)
    $prefix = "$Service/"
    if ($TargetName.StartsWith($prefix)) {
        return $TargetName.Substring($prefix.Length)
    }
    return $TargetName
}

try {
    if ($args.Count -lt 2) {
        [Console]::Error.WriteLine("Usage: credential-helper.ps1 <command> <service> [account]")
        exit 3
    }

    $command = $args[0]
    $service = $args[1]

    switch ($command) {
        'set' {
            if ($args.Count -ne 3) {
                [Console]::Error.WriteLine("Usage: credential-helper.ps1 set <service> <account>")
                exit 3
            }
            $account = $args[2]
            $targetName = Get-TargetName -Service $service -Account $account
            $value = [Console]::In.ReadToEnd()
            [CredentialManager]::WriteCredential($targetName, $value)
        }
        'get' {
            if ($args.Count -ne 3) {
                [Console]::Error.WriteLine("Usage: credential-helper.ps1 get <service> <account>")
                exit 3
            }
            $account = $args[2]
            $targetName = Get-TargetName -Service $service -Account $account
            $result = [CredentialManager]::ReadCredential($targetName)
            if ($null -eq $result) {
                exit 1
            }
            [Console]::Out.Write($result)
        }
        'delete' {
            if ($args.Count -ne 3) {
                [Console]::Error.WriteLine("Usage: credential-helper.ps1 delete <service> <account>")
                exit 3
            }
            $account = $args[2]
            $targetName = Get-TargetName -Service $service -Account $account
            $deleted = [CredentialManager]::DeleteCredential($targetName)
            if (-not $deleted) {
                exit 1
            }
        }
        'list' {
            if ($args.Count -ne 2) {
                [Console]::Error.WriteLine("Usage: credential-helper.ps1 list <service>")
                exit 3
            }
            $filter = Get-FilterPattern -Service $service
            $targets = [CredentialManager]::EnumerateCredentials($filter)
            $accounts = @()
            foreach ($target in $targets) {
                $accounts += Get-AccountFromTargetName -Service $service -TargetName $target
            }
            $accounts = @($accounts | Sort-Object)
            if ($accounts.Count -eq 0) {
                [Console]::Out.Write("[]")
            } else {
                [Console]::Out.Write((ConvertTo-Json -InputObject $accounts -Compress))
            }
        }
        'export' {
            if ($args.Count -ne 2) {
                [Console]::Error.WriteLine("Usage: credential-helper.ps1 export <service>")
                exit 3
            }
            $filter = Get-FilterPattern -Service $service
            $targets = [CredentialManager]::EnumerateCredentials($filter)
            $exported = @{}
            foreach ($target in $targets) {
                $account = Get-AccountFromTargetName -Service $service -TargetName $target
                $value = [CredentialManager]::ReadCredential($target)
                if ($null -ne $value) {
                    $exported[$account] = $value
                }
            }
            [Console]::Out.Write(($exported | ConvertTo-Json -Compress))
        }
        default {
            [Console]::Error.WriteLine("Unknown command: $command")
            exit 3
        }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 3
}
