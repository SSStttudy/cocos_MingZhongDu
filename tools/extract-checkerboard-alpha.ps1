param(
    [Parameter(Mandatory = $true)]
    [string[]]$Path
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourceCode = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class CheckerboardAlphaExtractor {
    private static bool IsBackground(byte red, byte green, byte blue) {
        int maximum = Math.Max(red, Math.Max(green, blue));
        int minimum = Math.Min(red, Math.Min(green, blue));
        double brightness = (red + green + blue) / 3.0;
        return brightness >= 188.0 && maximum - minimum <= 24;
    }

    public static double Process(string path) {
        using (var loaded = new Bitmap(new MemoryStream(File.ReadAllBytes(path))))
        using (var bitmap = new Bitmap(loaded.Width, loaded.Height, PixelFormat.Format32bppArgb)) {
            using (var graphics = Graphics.FromImage(bitmap)) {
                graphics.DrawImageUnscaled(loaded, 0, 0);
            }

            int width = bitmap.Width;
            int height = bitmap.Height;
            var rectangle = new Rectangle(0, 0, width, height);
            var data = bitmap.LockBits(rectangle, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            int stride = data.Stride;
            byte[] pixels = new byte[Math.Abs(stride) * height];
            Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);

            var background = new bool[width * height];
            var queued = new bool[width * height];
            var queue = new Queue<int>();

            Action<int, int> add = (x, y) => {
                int index = y * width + x;
                if (queued[index]) return;
                int pixel = y * stride + x * 4;
                if (!IsBackground(pixels[pixel + 2], pixels[pixel + 1], pixels[pixel])) return;
                queued[index] = true;
                queue.Enqueue(index);
            };

            for (int x = 0; x < width; x++) {
                add(x, 0);
                add(x, height - 1);
            }
            for (int y = 1; y < height - 1; y++) {
                add(0, y);
                add(width - 1, y);
            }

            int transparent = 0;
            while (queue.Count > 0) {
                int index = queue.Dequeue();
                if (background[index]) continue;
                background[index] = true;
                transparent++;
                int x = index % width;
                int y = index / width;
                if (x > 0) add(x - 1, y);
                if (x + 1 < width) add(x + 1, y);
                if (y > 0) add(x, y - 1);
                if (y + 1 < height) add(x, y + 1);
            }

            for (int y = 0; y < height; y++) {
                for (int x = 0; x < width; x++) {
                    int pixel = y * stride + x * 4;
                    pixels[pixel + 3] = background[y * width + x] ? (byte)0 : (byte)255;
                }
            }

            Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
            bitmap.UnlockBits(data);

            string temporary = path + ".alpha-fixed.png";
            bitmap.Save(temporary, ImageFormat.Png);
            File.Copy(temporary, path, true);
            File.Delete(temporary);
            return 100.0 * transparent / (width * height);
        }
    }
}
'@

Add-Type -TypeDefinition $sourceCode -ReferencedAssemblies System.Drawing

foreach ($inputPath in $Path) {
    $resolved = (Resolve-Path -LiteralPath $inputPath).Path
    if ([System.IO.Path]::GetExtension($resolved) -ne '.png') {
        throw "Only PNG files are supported: $resolved"
    }
    $percent = [CheckerboardAlphaExtractor].GetMethod('Process').Invoke($null, @($resolved))
    [PSCustomObject]@{
        Path = $resolved
        TransparentPercent = [Math]::Round([double]$percent, 2)
    }
}
