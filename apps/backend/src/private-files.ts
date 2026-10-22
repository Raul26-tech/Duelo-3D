import { execFileSync } from 'node:child_process';
import {
    chmodSync,
    closeSync,
    constants,
    fstatSync,
    lstatSync,
    openSync,
    readSync,
    statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, parse, win32 } from 'node:path';

// Windows PowerShell 5.1 / .NET Framework: the DACL is supplied at CreateNew,
// before any credential bytes exist. No shell interpolation, profiles or secrets.
const script = String.raw`
$ErrorActionPreference = 'Stop'
try {
    $path = $env:DUELO_PRIVATE_PATH
    $action = $env:DUELO_PRIVATE_ACTION
    $cursor = $path
    while ($true) {
        if ([System.IO.File]::Exists($cursor) -or [System.IO.Directory]::Exists($cursor)) {
            $attributes = [System.IO.File]::GetAttributes($cursor)
            if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse' }
        }
        $parent = [System.IO.Path]::GetDirectoryName($cursor)
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
    if ($action -eq 'paths') { exit 0 }
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    if ($action -eq 'create' -or $action -eq 'directory') {
        if ($action -eq 'create') {
            $security = New-Object System.Security.AccessControl.FileSecurity
            $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
        } else {
            $security = New-Object System.Security.AccessControl.DirectorySecurity
            $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
        }
        $security.SetOwner($sid)
        $security.SetAccessRuleProtection($true, $false)
        $security.AddAccessRule($rule)
        if ($action -eq 'create') {
            $stream = [System.IO.FileStream]::new($path, [System.IO.FileMode]::CreateNew, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::None, $security)
            $stream.Dispose()
        } else {
            [System.IO.Directory]::SetAccessControl($path, $security)
        }
    }
    $acl = Get-Acl -LiteralPath $path
    if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'owner/inheritance' }
    $ownerFull = $false
    foreach ($ace in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
        if ($ace.AccessControlType -ne 'Allow' -or $ace.IsInherited) { throw 'unsupported ACE' }
        if ($ace.IdentityReference.Value -eq $sid.Value) {
            $full = [System.Security.AccessControl.FileSystemRights]::FullControl
            if (($ace.FileSystemRights -band $full) -eq $full) { $ownerFull = $true }
        } elseif ($ace.IdentityReference.Value -ne 'S-1-5-18') { throw 'foreign access' }
    }
    if (-not $ownerFull) { throw 'missing owner rights' }
    exit 0
} catch { exit 1 }
`;
function windowsFile(
    action: 'create' | 'verify' | 'directory' | 'paths',
    path: string,
) {
    const windows = process.env.SystemRoot ?? 'C:\\Windows';
    try {
        execFileSync(
            join(
                windows,
                'System32',
                'WindowsPowerShell',
                'v1.0',
                'powershell.exe',
            ),
            [
                '-NoLogo',
                '-NoProfile',
                '-NonInteractive',
                '-EncodedCommand',
                Buffer.from(script, 'utf16le').toString('base64'),
            ],
            {
                env: {
                    ...process.env,
                    DUELO_PRIVATE_PATH: path,
                    DUELO_PRIVATE_ACTION: action,
                },
                stdio: 'ignore',
                windowsHide: true,
                timeout: 15000,
            },
        );
    } catch {
        throw new Error(
            'Private file operation refused: require a local ACL-capable volume, current-user ownership, protected DACL (only current user and optional SYSTEM), no reparse points, and Windows PowerShell 5.1',
        );
    }
}
/** Native Windows syntax, without accepting drive-relative/device/network/ADS paths. */
export function isLocalAbsolutePath(
    path: string,
    platform: NodeJS.Platform = process.platform,
) {
    if (path.includes('\0')) return false;
    if (platform !== 'win32') return isAbsolute(path);
    return (
        win32.isAbsolute(path) &&
        /^[a-z]:[\\/]/iu.test(path) &&
        !path.slice(2).includes(':') &&
        !/[<>"|?*]/u.test(path.slice(2)) &&
        path
            .slice(3)
            .split(/[\\/]/u)
            .every(
                (part) =>
                    !/[. ]$/u.test(part) &&
                    !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(
                        part,
                    ),
            )
    );
}
/** Reject symlink/junction ancestors, including a dangling final link. */
function assertPathComponents(path: string) {
    if (!isLocalAbsolutePath(path))
        throw new Error(
            'Path must be absolute on a local drive, without device namespace, ADS or invalid components',
        );
    // Walk the supplied components before normalizing: link/../file must not hide a link.
    let cursor = path;
    for (;;) {
        try {
            if (lstatSync(cursor).isSymbolicLink())
                throw new Error('Symlink/reparse paths are not supported');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        const parent = dirname(cursor);
        if (parent === cursor || cursor === parse(cursor).root) break;
        cursor = parent;
    }
}
export function assertLocalPath(path: string) {
    assertPathComponents(path);
    if (process.platform === 'win32') windowsFile('paths', path);
}
/** New files only. Existing ACLs/credentials are never repaired or overwritten. */
export function createPrivateFile(path: string): number {
    assertPathComponents(path);
    if (process.platform !== 'win32') return openSync(path, 'wx', 0o600);
    windowsFile('create', path);
    const identity = lstatSync(path, { bigint: true });
    const fd = openSync(path, 'r+');
    try {
        const opened = fstatSync(fd, { bigint: true });
        if (
            identity.dev !== opened.dev ||
            identity.ino !== opened.ino ||
            opened.nlink !== 1n
        )
            throw new Error('Private file identity changed');
        assertPrivateFile(path);
        return fd;
    } catch (error) {
        closeSync(fd);
        throw error;
    }
}
export function assertPrivateFile(path: string) {
    assertPathComponents(path);
    const stat = statSync(path);
    if (!stat.isFile() || stat.nlink !== 1)
        throw new Error('Private regular file required');
    if (process.platform === 'win32') windowsFile('verify', path);
    else if ((stat.mode & 0o077) !== 0)
        throw new Error('Private file requires POSIX 0600');
}
/** Only for a newly allocated, owned temporary directory; never an operator directory. */
export function protectTemporaryDirectory(path: string) {
    assertPathComponents(path);
    if (process.platform === 'win32') windowsFile('directory', path);
    else chmodSync(path, 0o700);
}

/** Bounded read of the same private file that was checked; close even on ACL failure. */
export function readPrivateFile(path: string, limit: number): Buffer {
    assertPrivateFile(path);
    const fd = openSync(
        path,
        constants.O_RDONLY |
            (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    try {
        const opened = fstatSync(fd, { bigint: true });
        const matches = () => {
            const named = lstatSync(path, { bigint: true });
            return (
                named.dev === opened.dev &&
                named.ino === opened.ino &&
                named.nlink === 1n &&
                named.isFile()
            );
        };
        if (!matches() || opened.size > BigInt(limit))
            throw new Error('Private file identity or size invalid');
        const buffer = Buffer.alloc(limit + 1);
        let length = 0,
            count: number;
        while (
            length < buffer.length &&
            (count = readSync(
                fd,
                buffer,
                length,
                buffer.length - length,
                null,
            )) > 0
        )
            length += count;
        assertPrivateFile(path);
        if (length > limit || !matches())
            throw new Error('Private file changed or exceeds limit');
        return buffer.subarray(0, length);
    } finally {
        closeSync(fd);
    }
}
