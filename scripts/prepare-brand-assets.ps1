Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceRoot = Split-Path -Parent $scriptRoot
$brandDirectory = Join-Path $workspaceRoot 'apps\mobile\assets\brand'

function Convert-ToTransparentBrandAsset {
  param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
  )

  $sourceImage = [System.Drawing.Bitmap]::FromFile($InputPath)
  $workingImage = New-Object System.Drawing.Bitmap(
    $sourceImage.Width,
    $sourceImage.Height,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $workingGraphics = [System.Drawing.Graphics]::FromImage($workingImage)
  $workingGraphics.DrawImageUnscaled($sourceImage, 0, 0)
  $workingGraphics.Dispose()
  $sourceImage.Dispose()

  $bounds = New-Object System.Drawing.Rectangle(0, 0, $workingImage.Width, $workingImage.Height)
  $bitmapData = $workingImage.LockBits(
    $bounds,
    [System.Drawing.Imaging.ImageLockMode]::ReadWrite,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $byteCount = [Math]::Abs($bitmapData.Stride) * $workingImage.Height
  $pixels = New-Object byte[] $byteCount
  [System.Runtime.InteropServices.Marshal]::Copy($bitmapData.Scan0, $pixels, 0, $byteCount)

  $minimumX = $workingImage.Width
  $minimumY = $workingImage.Height
  $maximumX = -1
  $maximumY = -1

  for ($y = 0; $y -lt $workingImage.Height; $y += 1) {
    $rowOffset = $y * $bitmapData.Stride

    for ($x = 0; $x -lt $workingImage.Width; $x += 1) {
      $pixelOffset = $rowOffset + ($x * 4)
      $blue = [double]$pixels[$pixelOffset]
      $green = [double]$pixels[$pixelOffset + 1]
      $red = [double]$pixels[$pixelOffset + 2]

      # Billy's supplied artwork is white on a dark green texture. Red-channel
      # separation preserves the original anti-aliased edge while removing the
      # green background without redrawing or approximating the monogram.
      $alphaFromRed = [Math]::Max(0.0, [Math]::Min(1.0, ($red - 28.0) / 220.0))
      $greenBias = [Math]::Max(0.0, $green - $red)
      $neutrality = 1.0 - [Math]::Max(0.0, [Math]::Min(1.0, ($greenBias - 8.0) / 82.0))
      $alphaStrength = [Math]::Min(1.0, $alphaFromRed * $neutrality * 1.7)
      $alpha = [int][Math]::Round(255.0 * $alphaStrength)

      if ($alpha -lt 5) {
        $alpha = 0
      }

      $pixels[$pixelOffset] = 255
      $pixels[$pixelOffset + 1] = 255
      $pixels[$pixelOffset + 2] = 255
      $pixels[$pixelOffset + 3] = [byte]$alpha

      if ($alpha -ge 12) {
        $minimumX = [Math]::Min($minimumX, $x)
        $minimumY = [Math]::Min($minimumY, $y)
        $maximumX = [Math]::Max($maximumX, $x)
        $maximumY = [Math]::Max($maximumY, $y)
      }
    }
  }

  [System.Runtime.InteropServices.Marshal]::Copy($pixels, 0, $bitmapData.Scan0, $byteCount)
  $workingImage.UnlockBits($bitmapData)

  if ($maximumX -lt $minimumX -or $maximumY -lt $minimumY) {
    $workingImage.Dispose()
    throw "No white Billy artwork was detected in $InputPath."
  }

  $artworkWidth = $maximumX - $minimumX + 1
  $artworkHeight = $maximumY - $minimumY + 1
  $padding = [int][Math]::Ceiling([Math]::Max($artworkWidth, $artworkHeight) * 0.08)
  $cropX = [Math]::Max(0, $minimumX - $padding)
  $cropY = [Math]::Max(0, $minimumY - $padding)
  $cropRight = [Math]::Min($workingImage.Width, $maximumX + $padding + 1)
  $cropBottom = [Math]::Min($workingImage.Height, $maximumY + $padding + 1)
  $cropRectangle = [System.Drawing.Rectangle]::new(
    [int]$cropX,
    [int]$cropY,
    [int]($cropRight - $cropX),
    [int]($cropBottom - $cropY)
  )

  $outputImage = $workingImage.Clone(
    $cropRectangle,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $outputImage.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $outputImage.Dispose()
  $workingImage.Dispose()
}

function New-SquareBrandCanvas {
  param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [int]$CanvasSize = 672
  )

  $sourceImage = [System.Drawing.Bitmap]::FromFile($InputPath)

  try {
    $canvas = New-Object System.Drawing.Bitmap(
      $CanvasSize,
      $CanvasSize,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)

    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $offsetX = [int][Math]::Floor(($CanvasSize - $sourceImage.Width) / 2)
      $offsetY = [int][Math]::Floor(($CanvasSize - $sourceImage.Height) / 2)
      $graphics.DrawImageUnscaled($sourceImage, $offsetX, $offsetY)
    }
    finally {
      $graphics.Dispose()
    }

    $canvas.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()
  }
  finally {
    $sourceImage.Dispose()
  }
}

Convert-ToTransparentBrandAsset `
  -InputPath (Join-Path $brandDirectory 'billy-mark.png') `
  -OutputPath (Join-Path $brandDirectory 'billy-mark-transparent.png')

Convert-ToTransparentBrandAsset `
  -InputPath (Join-Path $brandDirectory 'billy-wordmark.png') `
  -OutputPath (Join-Path $brandDirectory 'billy-wordmark-transparent.png')

New-SquareBrandCanvas `
  -InputPath (Join-Path $brandDirectory 'billy-mark-transparent.png') `
  -OutputPath (Join-Path $brandDirectory 'billy-mark-adaptive.png')

Write-Output 'Prepared exact transparent Billy brand assets.'
