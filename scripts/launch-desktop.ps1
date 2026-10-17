param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopRoot = Join-Path $projectRoot 'apps\desktop'
$electronExe = Join-Path $desktopRoot 'node_modules\electron\dist\electron.exe'
try {
    if (-not (Test-Path -LiteralPath $electronExe -PathType Leaf)) {
        throw '客户端运行环境尚未准备好。请让开发侧补齐运行依赖后再打开；无需在模型设置中修改密钥。'
    }
    foreach ($requiredFile in @('dist\main.js', 'dist\worker.js', 'dist\preload.cjs', 'dist\renderer\index.html')) {
        if (-not (Test-Path -LiteralPath (Join-Path $desktopRoot $requiredFile) -PathType Leaf)) {
            throw ('客户端构建不完整，缺少：' + $requiredFile + '。请让开发侧重新构建后再打开。作品文件不会因此被修改。')
        }
    }
    if ($CheckOnly) { Write-Output 'READY'; exit 0 }
    Start-Process -FilePath $electronExe -ArgumentList ('"' + $desktopRoot + '"') -WorkingDirectory $projectRoot -WindowStyle Normal
} catch {
    if ($CheckOnly) { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, '小说智能体：启动未完成', 'OK', 'Error') | Out-Null
}
