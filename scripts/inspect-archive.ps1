# 离线检查 DeepSeek 导出的历史 ZIP，输出 UTF-8 报告
param(
  [string]$ZipPath = "C:\Users\昆明冶\Downloads\deepseek_data-2026-11-18.zip",
  [string]$OutPath = "C:\Users\昆明冶\Desktop\deepseek\.tmp\zip-report.txt"
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$report = New-Object System.Collections.Generic.List[string]

function Add-Line([string]$text) { $report.Add($text) }

Add-Line ("文件: " + $ZipPath)
$fileInfo = Get-Item -LiteralPath $ZipPath
Add-Line ("大小: " + [math]::Round($fileInfo.Length / 1MB, 2) + " MB")
Add-Line ("修改时间: " + $fileInfo.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
Add-Line ""

$zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  $entries = $zip.Entries
  Add-Line ("条目总数: " + $entries.Count)
  $totalUncompressed = ($entries | Measure-Object -Property Length -Sum).Sum
  Add-Line ("解压后总大小: " + [math]::Round($totalUncompressed / 1MB, 2) + " MB")
  Add-Line ""

  Add-Line "--- 顶层结构 ---"
  $groups = $entries | Group-Object { ($_.FullName -split '/')[0] } | Sort-Object Count -Descending
  foreach ($g in $groups) { Add-Line ("  " + $g.Name + "  (" + $g.Count + " 项)") }
  Add-Line ""

  # manifest
  $manifestEntry = $entries | Where-Object { $_.FullName -eq 'manifest.json' } | Select-Object -First 1
  if ($manifestEntry) {
    $reader = New-Object System.IO.StreamReader($manifestEntry.Open(), [System.Text.Encoding]::UTF8)
    $manifestText = $reader.ReadToEnd()
    $reader.Close()
    Add-Line "--- manifest.json ---"
    Add-Line ("  " + $manifestText.Trim())
    Add-Line ""
  } else {
    Add-Line "!! 缺少 manifest.json（导入器要求它必须是第一个条目）"
  }

  # index
  $indexEntry = $entries | Where-Object { $_.FullName -eq 'chat_session_index.json' } | Select-Object -First 1
  if ($indexEntry) {
    $reader = New-Object System.IO.StreamReader($indexEntry.Open(), [System.Text.Encoding]::UTF8)
    $indexText = $reader.ReadToEnd()
    $reader.Close()
    $index = $indexText | ConvertFrom-Json
    Add-Line "--- chat_session_index.json ---"
    Add-Line ("  会话数: " + @($index).Count)
    $pinnedCount = @($index | Where-Object { $_.pinned -eq $true }).Count
    Add-Line ("  置顶会话: " + $pinnedCount)
    $nullTitle = @($index | Where-Object { $null -eq $_.title }).Count
    Add-Line ("  标题为 null 的会话: " + $nullTitle)
    $sampleTitles = @($index | Select-Object -First 5 -ExpandProperty title) -join ' | '
    Add-Line ("  前 5 个标题: " + $sampleTitles)
    Add-Line ""
  } else {
    Add-Line "!! 缺少 chat_session_index.json"
  }

  # session files
  $sessionEntries = $entries | Where-Object { $_.FullName -match '^chat_sessions/[^/]+\.json$' }
  Add-Line ("--- 会话 JSON: " + $sessionEntries.Count + " 个 ---")
  $nameless = @($sessionEntries | Where-Object { $_.Name -match '[^\x00-\x7F]' }).Count
  Add-Line ("  文件名含非 ASCII 字符: " + $nameless)

  $sample = $sessionEntries | Sort-Object Length | Select-Object -First 1
  if ($sample) {
    $reader = New-Object System.IO.StreamReader($sample.Open(), [System.Text.Encoding]::UTF8)
    $sessionText = $reader.ReadToEnd()
    $reader.Close()
    $session = $sessionText | ConvertFrom-Json
    Add-Line ("  样本文件: " + $sample.FullName + "（" + [math]::Round($sample.Length / 1KB, 1) + " KB）")
    Add-Line ("  字段: " + (($session.PSObject.Properties.Name) -join ', '))
    Add-Line ("  title: " + $session.title)
    Add-Line ("  pinned: " + $session.pinned)
    Add-Line ("  current_message_id: " + $session.current_message_id)
    $messages = @($session.messages)
    Add-Line ("  消息数: " + $messages.Count)
    $roles = ($messages | Group-Object role | ForEach-Object { $_.Name + '=' + $_.Count }) -join ', '
    Add-Line ("  role 分布: " + $roles)
    $fragTypes = @()
    foreach ($m in $messages) {
      foreach ($f in @($m.fragments)) { $fragTypes += [string]$f.type }
    }
    $fragGroups = ($fragTypes | Group-Object | ForEach-Object { $_.Name + '=' + $_.Count }) -join ', '
    Add-Line ("  片段类型: " + $fragGroups)
    $maxId = ($messages | Measure-Object -Property id -Maximum).Maximum
    Add-Line ("  最大消息 id: " + $maxId)
  }
  Add-Line ""

  # images
  $imageEntries = $entries | Where-Object { $_.FullName -match '^chat_sessions/[^/]+_files/' }
  Add-Line ("--- 附件/图片原件: " + $imageEntries.Count + " 个 ---")
  $extGroups = $imageEntries | Group-Object { [System.IO.Path]::GetExtension($_.FullName).ToLower() } | Sort-Object Count -Descending
  foreach ($g in $extGroups) { Add-Line ("  " + $g.Name + ": " + $g.Count) }
  $imgTotal = ($imageEntries | Measure-Object -Property Length -Sum).Sum
  Add-Line ("  原始总大小: " + [math]::Round($imgTotal / 1MB, 2) + " MB")

  # 兼容性提示
  Add-Line ""
  Add-Line "--- 兼容性检查 ---"
  $badPath = @($entries | Where-Object { $_.FullName -match '\\' -or $_.FullName -match '(^|/)\.\.(/|$)' })
  Add-Line ("  含反斜杠/越界路径的条目: " + $badPath.Count)
  $zip64Like = $entries.Count -eq 0
  Add-Line ("  ZIP64/分卷: 无法从条目直接判定；138 MB 单卷通常在 ZIP32 范围内")
}
finally {
  $zip.Dispose()
}

[System.IO.File]::WriteAllText($OutPath, ($report -join "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("报告已写入: " + $OutPath)