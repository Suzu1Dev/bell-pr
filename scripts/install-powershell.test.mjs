import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const installer = fileURLToPath(new URL("../install.ps1", import.meta.url));
const candidates = process.env.BELLPR_TEST_POWERSHELL
  ? [process.env.BELLPR_TEST_POWERSHELL]
  : process.platform === "win32" ? ["powershell", "pwsh"] : ["pwsh"];
const powershell = candidates.find((command) => spawnSync(command, ["-NoLogo", "-NoProfile", "-Command", "exit 0"], {
  timeout: 15_000, windowsHide: true,
}).status === 0);
if (process.env.BELLPR_TEST_POWERSHELL && !powershell) throw new Error("BELLPR_TEST_POWERSHELL could not run");

// Each installer runs in its own PowerShell process: its exit statements cannot
// terminate Node. Every WSL/network boundary is mocked before loading the script.
const driver = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$Scenario = ConvertFrom-Json $env:BELLPR_FIXTURE_SCENARIO
function Record-Fixture($Entry) {
    Add-Content -LiteralPath $env:BELLPR_FIXTURE_LOG -Value (ConvertTo-Json -InputObject $Entry -Compress -Depth 5) -Encoding UTF8
}
function Get-Command {
    [CmdletBinding()]
    param([string]$Name)
    if ($Name -ne 'wsl.exe') { throw 'Unexpected command lookup' }
    if (-not $Scenario.MissingWsl) { [pscustomobject]@{ Name = 'wsl.exe' } }
}
function wsl.exe {
    Record-Fixture @{ command = 'wsl'; arguments = @($args) }
    $global:LASTEXITCODE = 0
    if ($args[0] -eq '--list') {
        $global:LASTEXITCODE = [int]$Scenario.ListExit
        $Listing = "  NAME STATE VERSION" + [Environment]::NewLine + "* $($Scenario.Distribution) Stopped $($Scenario.WslVersion)"
        if ($Scenario.NulListing) { $Listing = [string]::Join([char]0, $Listing.ToCharArray()) }
        Write-Output $Listing
        return
    }
    # PowerShell consumes the standalone -- when invoking a function mock.
    switch ($args[2]) {
        'id' { Write-Output $Scenario.UserId }
        'wslpath' {
            $global:LASTEXITCODE = [int]$Scenario.PathExit
            Write-Output '/tmp/bellpr-fixture-helper.sh'
        }
        'bash' { $global:LASTEXITCODE = [int]$Scenario.HelperExit }
        default { throw 'Unexpected WSL command' }
    }
}
function Invoke-WebRequest {
    [CmdletBinding()]
    param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing)
    Record-Fixture @{ command = 'download'; uri = $Uri; file = $OutFile }
    Set-Content -LiteralPath $OutFile -Value '# Fixture only; never executed.' -Encoding UTF8
}
$Parameters = @{}
(ConvertFrom-Json $env:BELLPR_FIXTURE_PARAMETERS).PSObject.Properties | ForEach-Object { $Parameters[$_.Name] = $_.Value }
& $env:BELLPR_FIXTURE_INSTALLER @Parameters
exit $LASTEXITCODE
`;

async function fixture(run, { parameters = {}, scenario = {}, localHelper = true, homepage } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-powershell-"));
  const checkout = path.join(directory, "checkout with space's");
  const log = path.join(directory, "commands.jsonl");
  const local = path.join(checkout, "scripts", "install-wsl.sh");
  try {
    await mkdir(path.dirname(local), { recursive: true });
    if (homepage === undefined) await copyFile(installer, path.join(checkout, "install.ps1"));
    else {
      const source = await readFile(installer, "utf8");
      assert.match(source, /^\$InstallerHomepage = '[^\r\n]*'$/m);
      await writeFile(path.join(checkout, "install.ps1"), source.replace(/^\$InstallerHomepage = '[^\r\n]*'$/m, () => `$InstallerHomepage = '${homepage.replaceAll("'", "''")}'`));
    }
    if (localHelper) await writeFile(local, "# A sibling must only be used with explicit -LocalHelper.\n");
    await writeFile(path.join(directory, "driver.ps1"), `\ufeff${driver}`);
    const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(directory, "driver.ps1")], {
      env: {
        ...process.env,
        BELLPR_FIXTURE_INSTALLER: path.join(checkout, "install.ps1"),
        BELLPR_FIXTURE_LOG: log,
        BELLPR_FIXTURE_PARAMETERS: JSON.stringify(parameters),
        BELLPR_FIXTURE_SCENARIO: JSON.stringify({ Distribution: "Ubuntu", WslVersion: 2, UserId: "1000", ...scenario }),
      },
      encoding: "utf8", timeout: 20_000, windowsHide: true,
    });
    assert.ifError(result.error);
    const calls = (await readFile(log, "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    })).replace(/^\ufeff/, "").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    await run({ ...result, calls, local });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("PowerShell source preserves UTF-8 BOM for Windows PowerShell 5.1", async () => {
  assert.deepEqual((await readFile(installer)).subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]));
});

test("PowerShell uses the website helper despite an adjacent script", { skip: !powershell }, async () => {
  await fixture(async (result) => {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const download = result.calls.find((call) => call.command === "download");
    assert.equal(download.uri, "https://install.example.test/bell/install-wsl.sh");
    const commands = result.calls.filter((call) => call.command === "wsl").map((call) => call.arguments);
    assert.deepEqual(commands.at(-1), ["-d", "Ubuntu", "bash", "/tmp/bellpr-fixture-helper.sh", "--provider", "codex", "--version", "latest", "--lang", "en"]);
    assert.equal(commands.at(-2).at(-1), download.file);
    assert.notEqual(download.file, result.local);
    await assert.rejects(stat(download.file), { code: "ENOENT" });
    assert.match(result.stdout, /After completing the sign-in commands/);
    assert.match(result.stdout, /wsl -d "Ubuntu" -- bash -lc '\$HOME\/\.local\/bin\/bell-pr'/);
  }, { homepage: "https://install.example.test/bell/" });
});

test("PowerShell falls back to GitHub only when the generated homepage is empty", { skip: !powershell }, async () => {
  await fixture(async (result) => {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const download = result.calls.find((call) => call.command === "download");
    assert.equal(download.uri, "https://raw.githubusercontent.com/Suzu1Dev/bell-pr/main/scripts/install-wsl.sh");
    await assert.rejects(stat(download.file), { code: "ENOENT" });
  }, { homepage: "" });
});

test("PowerShell rejects a non-HTTPS generated homepage before downloading", { skip: !powershell }, async () => {
  await fixture(async (result) => {
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(result.calls.some((call) => call.command === "download"), false);
  }, { homepage: "http://install.example.test" });
});

test("PowerShell explicitly selects local helper with bounded arguments and Traditional Chinese output", { skip: !powershell }, async () => {
  await fixture(async (result) => {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.calls.some((call) => call.command === "download"), false);
    const commands = result.calls.map((call) => call.arguments);
    assert.equal(await realpath(commands.at(-2).at(-1)), await realpath(result.local));
    assert.deepEqual(commands.at(-1), ["-d", "Ubuntu Dev", "bash", "/tmp/bellpr-fixture-helper.sh", "--provider", "none", "--version", "1.2.3-rc.1", "--lang", "zh-TW"]);
    assert.match(result.stdout, /正在 WSL2 發行版「Ubuntu Dev」內安裝/);
    assert.match(result.stdout, /完成上述登入指令後/);
    assert.match(result.stdout, /bell-pr start --force/);
  }, {
    parameters: { LocalHelper: true, Distribution: "Ubuntu Dev", Provider: "none", Version: "1.2.3-rc.1", Lang: "zh-TW" },
    scenario: { Distribution: "Ubuntu Dev", NulListing: true },
  });
});

test("PowerShell rejects missing WSL, missing distro, WSL1, and root before installing", { skip: !powershell }, async () => {
  for (const [scenario, output, status] of [
    [{ MissingWsl: true }, /wsl --install -d Ubuntu.*Restart Windows/, 1],
    [{ ListExit: 71 }, /wsl --install -d Ubuntu/, 71],
    [{ Distribution: "Debian" }, /was not found/, 1],
    [{ WslVersion: 1 }, /wsl --set-version "Ubuntu" 2/, 1],
    [{ UserId: "0" }, /regular default Linux user/, 1],
  ]) {
    await fixture(async (result) => {
      assert.equal(result.status, status, result.stderr || result.stdout);
      assert.match(result.stdout, output);
      assert.equal(result.calls.some((call) => call.command === "download" || call.arguments?.includes("bash")), false);
    }, { scenario });
  }
});

test("PowerShell rejects unknown and injectable parameter values before WSL access", { skip: !powershell }, async () => {
  for (const parameters of [
    { Version: "1.0.0; Write-Output injected" },
    { Provider: "$(Write-Output injected)" },
    { Distribution: "Ubuntu; Write-Output injected" },
    { Lang: "invalid" },
    { UnknownOption: "ignored" },
  ]) {
    await fixture(async (result) => {
      assert.notEqual(result.status, 0);
      assert.deepEqual(result.calls, []);
      if (!parameters.UnknownOption) assert.equal(result.status, 2);
    }, { parameters });
  }
});

test("PowerShell preserves WSL helper/path failures and cleans its download", { skip: !powershell }, async () => {
  for (const scenario of [{ HelperExit: 49 }, { PathExit: 23 }]) {
    await fixture(async (result) => {
      assert.equal(result.status, Object.values(scenario)[0], result.stderr || result.stdout);
      assert.doesNotMatch(result.stdout, /After completing the sign-in commands/);
      const download = result.calls.find((call) => call.command === "download");
      await assert.rejects(stat(download.file), { code: "ENOENT" });
    }, { scenario });
  }
});

test("PowerShell does not download a fallback when explicit local helper is absent", { skip: !powershell }, async () => {
  await fixture(async (result) => {
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /Installation failed/);
    assert.equal(result.calls.some((call) => call.command === "download" || call.arguments?.includes("bash")), false);
  }, { parameters: { LocalHelper: true }, localHelper: false });
});
