param([Parameter(Mandatory = $true)][string]$OutPath)
# Prints one JSON line: {type: image|files|text|none, files?, text?}
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$result = @{ type = 'none' }
$cb = [System.Windows.Forms.Clipboard]

if ($cb::ContainsFileDropList()) {
    $files = @($cb::GetFileDropList() | ForEach-Object { [string]$_ })
    $result = @{ type = 'files'; files = $files }
}
elseif ($cb::ContainsData('PNG')) {
    # Browsers/Figma/Photoshop put real PNG bytes here (keeps transparency).
    $data = $cb::GetData('PNG')
    $fs = [System.IO.File]::Create($OutPath)
    try {
        if ($data -is [System.IO.Stream]) { $data.CopyTo($fs) } else { $fs.Write([byte[]]$data, 0, $data.Length) }
    } finally { $fs.Close() }
    $result = @{ type = 'image'; files = @($OutPath) }
}
elseif ($cb::ContainsImage()) {
    $img = $cb::GetImage()
    $img.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $img.Dispose()
    $result = @{ type = 'image'; files = @($OutPath) }
}
elseif ($cb::ContainsText()) {
    $result = @{ type = 'text'; text = $cb::GetText() }
}

$result | ConvertTo-Json -Compress
