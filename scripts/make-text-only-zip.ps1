# 从 DeepSeek 导出的历史 ZIP 中剔除图片原件，生成只含文字记录的轻量 ZIP
param(
  [string]$Source = "C:\Users\昆明冶\Desktop\deepseek_data-2026-11-18.zip",
  [string]$Destination = "C:\Users\昆明冶\Desktop\deepseek\import-text-only.zip"
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$src = [System.IO.Compression.ZipFile]::OpenRead($Source)
try {
  if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }
  $dstStream = [System.IO.File]::Create($Destination)
  $dst = New-Object System.IO.Compression.ZipArchive($dstStream, [System.IO.Compression.ZipArchiveMode]::Create)
  $kept = 0
  $skipped = 0
  foreach ($entry in $src.Entries) {
    # 跳过所有会话目录下的原件（图片）；保留 manifest / user / 会话 JSON / 索引
    if ($entry.FullName -match '^chat_sessions/[^/]+_files/') { $skipped++; continue }
    $newEntry = $dst.CreateEntry($entry.FullName, [System.IO.Compression.CompressionLevel]::Optimal)
    $in = $entry.Open()
    $out = $newEntry.Open()
    try { $in.CopyTo($out) } finally { $out.Dispose(); $in.Dispose() }
    $kept++
  }
  $dst.Dispose()
  $dstStream.Dispose()
  Write-Output ("已生成: " + $Destination)
  Write-Output ("保留条目: " + $kept + "，跳过图片: " + $skipped)
}
finally {
  $src.Dispose()
}