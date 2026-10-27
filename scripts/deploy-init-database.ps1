#Requires -Version 7.3
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9-]+$')][string]$EnvId,
    [string]$Region = 'ap-shanghai',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$cli = (Get-Command tcb.ps1 -ErrorAction Stop).Source
$wxAppId = (Get-Content -LiteralPath (Join-Path $repo 'project.config.json') -Raw | ConvertFrom-Json).appid
$collection = 'member_management_logs'

function Invoke-TcbJson([string[]]$CliArgs) {
    $output = (& $cli @CliArgs 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "CloudBase 操作失败：$output" }
    # api 命令在 JSON 前输出操作名；保留完整 JSON，不依赖终端颜色或行数。
    $start = $output.IndexOf('{')
    if ($start -lt 0) { throw "CloudBase 未返回 JSON：$output" }
    $parsed = $output.Substring($start) | ConvertFrom-Json
    if ($parsed.error) { throw ($parsed.error | ConvertTo-Json -Compress) }
    return $parsed.data
}

function Invoke-DatabaseApi([string]$Action, [hashtable]$Body) {
    $Body.EnvId = $EnvId
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    return Invoke-TcbJson @('api', 'tcb', $Action, '-e', $EnvId, '-r', $Region, '--body', $json, '--json')
}

$tables = Invoke-DatabaseApi 'DescribeTables' @{ TableNames = @($collection); MgoLimit = 1; MgoOffset = 0 }
$exists = @($tables.Tables | Where-Object TableName -eq $collection).Count -eq 1
$rule = if ($exists) { Invoke-DatabaseApi 'DescribeSafeRule' @{ CollectionName = $collection; WxAppId = $wxAppId } } else { $null }
Write-Host "环境：$EnvId；地区：$Region；日志集合已存在：$exists"
if ($DryRun) {
    Write-Host '演练：补建缺失日志集合、设置并复核禁止客户端读写的规则、备份并部署 initDataBase；不修改成员数据。'
    return
}

# 先备份；已有集合的规则与云函数代码仅保存在 Git 忽略目录。
$evidence = Join-Path $repo ('.eidos/deploy-init-database/' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
& git -C $repo check-ignore --quiet ($evidence + '/placeholder.json')
if ($LASTEXITCODE -ne 0) { throw '备份目录未被 Git 忽略，停止部署' }
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$tables | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidence 'tables-before.json') -Encoding utf8
if ($rule) { $rule | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidence 'rule-before.json') -Encoding utf8 }
$null = Invoke-TcbJson @('fn', 'code', 'download', 'initDataBase', (Join-Path $evidence 'initDataBase-before'), '-e', $EnvId, '-r', $Region, '--json')

if (!$exists) {
    $null = Invoke-DatabaseApi 'CreateTable' @{ TableName = $collection; PermissionInfo = @{ AclTag = 'ADMINONLY'; EnvId = $EnvId } }
}
$rules = Get-Content -LiteralPath (Join-Path $repo 'cloudfunctions/initDataBase/member_management_logs.rules.json') -Raw | ConvertFrom-Json
if ($rules.read -ne $false -or $rules.write -ne $false) { throw '日志规则必须禁止客户端读写' }
$null = Invoke-DatabaseApi 'ModifySafeRule' @{ CollectionName = $collection; AclTag = 'CUSTOM'; Rule = ($rules | ConvertTo-Json -Compress) }
$actual = Invoke-DatabaseApi 'DescribeSafeRule' @{ CollectionName = $collection; WxAppId = $wxAppId }
$actual | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidence 'rule-after.json') -Encoding utf8
if ($actual.AclTag -ne 'ADMINONLY') {
    $actualRule = $actual.Rule | ConvertFrom-Json
    if ($actualRule.read -ne $false -or $actualRule.write -ne $false) { throw '日志权限复核失败，停止部署' }
}
$null = Invoke-TcbJson @('fn', 'deploy', 'initDataBase', '--dir', (Join-Path $repo 'cloudfunctions/initDataBase'), '--force', '--install-dependency', 'true', '-e', $EnvId, '-r', $Region, '--json')
for ($attempt = 0; $attempt -lt 24; $attempt++) {
    $deployed = Invoke-TcbJson @('fn', 'detail', 'initDataBase', '-e', $EnvId, '-r', $Region, '--json')
    if ($deployed.Status -eq 'Active') { break }
    if ($deployed.Status -notin @('Creating', 'Updating')) { throw "initDataBase 部署未就绪：$($deployed.Status)" }
    Start-Sleep -Seconds 5
}
if ($deployed.Status -ne 'Active') { throw 'initDataBase 仍在部署，请查询云端状态；不要重复上传' }
@{ FunctionName = $deployed.FunctionName; Status = $deployed.Status; ModTime = $deployed.ModTime } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'deployment.json') -Encoding utf8
Write-Host "日志集合及权限已就绪，initDataBase 已部署。备份：$evidence"
