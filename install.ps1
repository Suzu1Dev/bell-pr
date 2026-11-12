# Run from PowerShell: .\install.ps1 -Distribution Ubuntu -Provider codex
[CmdletBinding()]
param(
    [string]$Distribution = 'Ubuntu',
    [string]$Provider = 'codex',
    [string]$Version = 'latest',
    [string]$Lang = 'en',
    [switch]$LocalHelper
)

$ErrorActionPreference = 'Stop'
# BEGIN GENERATED PRODUCT METADATA
$InstallerRepository = 'https://github.com/Suzu1Dev/bell-pr'
$InstallerRef = 'main'
$InstallerHomepage = 'https://bell-pr.suzu.tw'
# END GENERATED PRODUCT METADATA

$Messages = @{
    en = @{
        Arguments = 'Use -Distribution <name>, -Provider codex|claude|none, -Version latest|<version>, -Lang en|zh-TW. -LocalHelper explicitly runs scripts/install-wsl.sh beside this installer (trusted checkouts only).'
        Wsl = 'WSL2 is required. In an Administrator PowerShell, run: wsl --install -d Ubuntu. Restart Windows if requested, open Ubuntu, and finish creating your Linux user. Then run this installer again.'
        Missing = 'Distribution "{0}" was not found. Run wsl --list --verbose to choose an existing distribution, or wsl --install -d Ubuntu. A restart and first-run Linux user creation may be required.'
        Wsl1 = 'Distribution "{0}" uses WSL1. Run: wsl --set-version "{0}" 2. Finish the conversion, then run this installer again.'
        Root = 'The default Linux user is root. Open this distribution, create/configure a regular default Linux user with sudo access, then run this installer again.'
        Installing = 'Installing inside WSL2 distribution "{0}". Linux sudo may ask for your password.'
        Failed = 'Installation failed: {0}'
        Launch = 'After completing the sign-in commands above, launch from PowerShell:'
    }
    'zh-TW' = @{
        Arguments = '請使用 -Distribution <名稱>、-Provider codex|claude|none、-Version latest|<版本>、-Lang en|zh-TW。-LocalHelper 明確使用安裝程式旁的 scripts/install-wsl.sh，僅適用於信任的原始碼目錄。'
        Wsl = '需要 WSL2。請在系統管理員 PowerShell 執行：wsl --install -d Ubuntu。若系統要求，請重新啟動 Windows，再開啟 Ubuntu 並完成 Linux 使用者建立，然後重新執行安裝程式。'
        Missing = '找不到發行版「{0}」。請執行 wsl --list --verbose 選擇現有發行版，或執行 wsl --install -d Ubuntu。可能需要重新啟動並完成首次 Linux 使用者建立。'
        Wsl1 = '發行版「{0}」使用 WSL1。請執行：wsl --set-version "{0}" 2。轉換完成後，重新執行安裝程式。'
        Root = '預設 Linux 使用者是 root。請開啟此發行版，建立並設定具有 sudo 權限的一般預設 Linux 使用者，再重新執行安裝程式。'
        Installing = '正在 WSL2 發行版「{0}」內安裝。Linux sudo 可能會要求輸入密碼。'
        Failed = '安裝失敗：{0}'
        Launch = '完成上述登入指令後，可從 PowerShell 啟動：'
    }
}
$Text = $Messages.en
if ($Messages.ContainsKey($Lang)) { $Text = $Messages[$Lang] }
if ($Lang -cnotin @('en', 'zh-TW') -or $Provider -cnotin @('codex', 'claude', 'none') -or
    $Distribution -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$' -or
    $Version -cnotmatch '^(latest|[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9]+([.-][A-Za-z0-9]+)*)?)$') {
    Write-Host $Text.Arguments
    exit 2
}
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    Write-Host $Text.Wsl
    exit 1
}

$DownloadedHelper = $null
try {
    # WSL's text can contain UTF-16 NULs when captured; the final version
    # column is stable even when Windows localizes the state/header text.
    $Listing = ((& wsl.exe --list --verbose 2>&1 | Out-String) -replace "`0", '')
    if ($LASTEXITCODE -ne 0) {
        Write-Host $Text.Wsl
        exit $LASTEXITCODE
    }
    $Pattern = '(?m)^\s*\*?\s*' + [regex]::Escape($Distribution) + '\s+.+?\s+([12])\s*$'
    $Found = [regex]::Match($Listing, $Pattern)
    if (-not $Found.Success) {
        Write-Host ($Text.Missing -f $Distribution)
        exit 1
    }
    if ($Found.Groups[1].Value -ne '2') {
        Write-Host ($Text.Wsl1 -f $Distribution)
        exit 1
    }
    $UserId = (& wsl.exe -d $Distribution -- id -u | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($UserId -eq '0') {
        Write-Host $Text.Root
        exit 1
    }
    if ($UserId -notmatch '^[1-9][0-9]*$') { throw $Text.Root }

    if ($LocalHelper) {
        $Helper = Join-Path $PSScriptRoot 'scripts/install-wsl.sh'
        if (-not (Test-Path -LiteralPath $Helper -PathType Leaf)) { throw $Text.Arguments }
    } else {
        $DownloadedHelper = [System.IO.Path]::GetTempFileName()
        if ($InstallerHomepage) {
            $Homepage = [uri]$InstallerHomepage
            if ($Homepage.Scheme -ne 'https' -or -not $Homepage.Host -or $Homepage.UserInfo -or $Homepage.Query -or $Homepage.Fragment) {
                throw $Text.Arguments
            }
            $Uri = $InstallerHomepage.TrimEnd('/') + '/install-wsl.sh'
        } else {
            $Repo = [uri]$InstallerRepository
            if ($Repo.Host -ne 'github.com' -or $InstallerRef -notmatch '^[A-Za-z0-9._/-]+$') {
                throw $Text.Arguments
            }
            $Uri = 'https://raw.githubusercontent.com' + $Repo.AbsolutePath.TrimEnd('/') + '/' + $InstallerRef + '/scripts/install-wsl.sh'
        }
        Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $DownloadedHelper
        $Helper = $DownloadedHelper
    }
    # Pass a file, not a stdin script: sudo keeps the interactive terminal.
    $LinuxHelper = (& wsl.exe -d $Distribution -- wslpath -a -u $Helper | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if (-not $LinuxHelper.StartsWith('/')) { throw $Text.Arguments }
    Write-Host ($Text.Installing -f $Distribution)
    & wsl.exe -d $Distribution -- bash $LinuxHelper --provider $Provider --version $Version --lang $Lang
    $Result = $LASTEXITCODE
    if ($Result -eq 0) {
        Write-Host $Text.Launch
        $Start = '$HOME/.local/bin/bell-pr'
        if ($Provider -eq 'none') { $Start += ' start --force' }
        Write-Host ('wsl -d "{0}" -- bash -lc ''{1}''' -f $Distribution, $Start)
    }
    exit $Result
} catch {
    Write-Host ($Text.Failed -f $_.Exception.Message)
    exit 1
} finally {
    if ($DownloadedHelper) { Remove-Item -LiteralPath $DownloadedHelper -Force -ErrorAction SilentlyContinue }
}
