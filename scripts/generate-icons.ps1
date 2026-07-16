$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$outputDirectory = Join-Path $PSScriptRoot "..\extension\icons"
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

foreach ($size in @(16, 48, 128)) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $margin = [float]($size * 0.055)
  $radius = [float]($size * 0.22)
  $backgroundPath = New-RoundedRectanglePath -X $margin -Y $margin -Width ($size - 2 * $margin) -Height ($size - 2 * $margin) -Radius $radius
  $redBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 240, 0, 0))
  $graphics.FillPath($redBrush, $backgroundPath)

  $playPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $playPath.AddPolygon(@(
    [System.Drawing.PointF]::new([float]($size * 0.27), [float]($size * 0.27)),
    [System.Drawing.PointF]::new([float]($size * 0.27), [float]($size * 0.73)),
    [System.Drawing.PointF]::new([float]($size * 0.55), [float]($size * 0.50))
  ))
  $whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $graphics.FillPath($whiteBrush, $playPath)

  $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, [float][Math]::Max(1.15, $size * 0.065))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawArc($pen, [float]($size * 0.43), [float]($size * 0.35), [float]($size * 0.30), [float]($size * 0.30), -48, 96)
  $graphics.DrawArc($pen, [float]($size * 0.47), [float]($size * 0.24), [float]($size * 0.42), [float]($size * 0.52), -48, 96)

  $path = Join-Path $outputDirectory "icon$size.png"
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

  $pen.Dispose()
  $whiteBrush.Dispose()
  $playPath.Dispose()
  $redBrush.Dispose()
  $backgroundPath.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

Write-Output "Generated extension icons in $outputDirectory"
