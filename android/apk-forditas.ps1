<#
.SYNOPSIS
    Letölti és beállítja az APK fordításához szükséges eszközöket, majd
    lefordítja az OCR Szövegkinyerő Android-alkalmazását.

.DESCRIPTION
    Semmit nem telepít a rendszerbe és nem nyúl a PATH-hoz: minden eszköz
    ebbe a mappába kerül -> android\.eszkozok

        JDK 17 (Temurin)          ~190 MB
        Android SDK parancssori   ~130 MB
        SDK platform + build-tools ~120 MB
        Gradle                    a wrapper tölti le, ~130 MB

    Ha később nem kell, elég törölni az android\.eszkozok mappát.

.PARAMETER Ujra
    Akkor is újratölti az eszközöket, ha már megvannak.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\android\apk-forditas.ps1
#>

[CmdletBinding()]
param(
    [switch]$Ujra
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# TLS 1.2 a régebbi PowerShell-eken
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AndroidGyoker = Split-Path -Parent $MyInvocation.MyCommand.Path
$Eszkozok      = Join-Path $AndroidGyoker '.eszkozok'
$JdkMappa      = Join-Path $Eszkozok 'jdk'
$SdkMappa      = Join-Path $Eszkozok 'android-sdk'

$JdkUrl = 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk'
$SdkUrl = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'

function Cim($szoveg) {
    Write-Host ''
    Write-Host "  $szoveg" -ForegroundColor Cyan
    Write-Host ('  ' + ('-' * $szoveg.Length)) -ForegroundColor DarkCyan
}

function Letolt($url, $cel, $mit) {
    Write-Host "  $mit letöltése..." -NoNewline
    $ideiglenes = "$cel.reszleges"
    try {
        # A BITS-nél megbízhatóbb és mindenhol elérhető
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $url -OutFile $ideiglenes -UseBasicParsing
        Move-Item -Force $ideiglenes $cel
        Write-Host ' kész' -ForegroundColor Green
    } catch {
        if (Test-Path $ideiglenes) { Remove-Item -Force $ideiglenes }
        throw "A letöltés nem sikerült ($url): $($_.Exception.Message)"
    }
}

function Kicsomagol($zip, $cel) {
    Write-Host '  Kicsomagolás...' -NoNewline
    if (Test-Path $cel) { Remove-Item -Recurse -Force $cel }
    Expand-Archive -Path $zip -DestinationPath $cel -Force
    Write-Host ' kész' -ForegroundColor Green
}


Write-Host ''
Write-Host '  OCR Szövegkinyerő - APK fordítása' -ForegroundColor White
Write-Host '  =================================' -ForegroundColor DarkGray

New-Item -ItemType Directory -Force -Path $Eszkozok | Out-Null


# ---------------------------------------------------------------------
# 1. JDK 17
# ---------------------------------------------------------------------
Cim 'JDK 17'

if ($Ujra -and (Test-Path $JdkMappa)) { Remove-Item -Recurse -Force $JdkMappa }

if (Test-Path (Join-Path $JdkMappa 'bin\java.exe')) {
    Write-Host '  Már megvan, kihagyva.' -ForegroundColor DarkGray
} else {
    $jdkZip = Join-Path $Eszkozok 'jdk.zip'
    Letolt $JdkUrl $jdkZip 'JDK 17 (kb. 190 MB)'
    $kicsomagolt = Join-Path $Eszkozok 'jdk-kicsomagolt'
    Kicsomagol $jdkZip $kicsomagolt

    # A ZIP egy jdk-17.x.y+z névű mappát tartalmaz; azt tesszük a helyére.
    $belso = Get-ChildItem -Directory $kicsomagolt | Select-Object -First 1
    if (Test-Path $JdkMappa) { Remove-Item -Recurse -Force $JdkMappa }
    Move-Item $belso.FullName $JdkMappa
    Remove-Item -Recurse -Force $kicsomagolt
    Remove-Item -Force $jdkZip
}

$env:JAVA_HOME = $JdkMappa
$env:PATH = (Join-Path $JdkMappa 'bin') + ';' + $env:PATH
Write-Host "  JAVA_HOME = $JdkMappa" -ForegroundColor DarkGray


# ---------------------------------------------------------------------
# 2. Android SDK
# ---------------------------------------------------------------------
Cim 'Android SDK'

$SdkManager = Join-Path $SdkMappa 'cmdline-tools\latest\bin\sdkmanager.bat'

if ($Ujra -and (Test-Path $SdkMappa)) { Remove-Item -Recurse -Force $SdkMappa }

if (Test-Path $SdkManager) {
    Write-Host '  A parancssori eszközök már megvannak, kihagyva.' -ForegroundColor DarkGray
} else {
    $sdkZip = Join-Path $Eszkozok 'cmdline-tools.zip'
    Letolt $SdkUrl $sdkZip 'Android parancssori eszközök (kb. 130 MB)'

    $kicsomagolt = Join-Path $Eszkozok 'sdk-kicsomagolt'
    Kicsomagol $sdkZip $kicsomagolt

    # Az sdkmanager csak akkor működik, ha a cmdline-tools\latest útvonalon van.
    $cel = Join-Path $SdkMappa 'cmdline-tools\latest'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $cel) | Out-Null
    Move-Item (Join-Path $kicsomagolt 'cmdline-tools') $cel
    Remove-Item -Recurse -Force $kicsomagolt
    Remove-Item -Force $sdkZip
}

$env:ANDROID_HOME     = $SdkMappa
$env:ANDROID_SDK_ROOT = $SdkMappa

Write-Host '  Licencek elfogadása...' -ForegroundColor DarkGray
# Az sdkmanager soronként kérdez; mindegyikre "y" a válasz.
$valaszok = ("y`n" * 30)
$valaszok | & $SdkManager --licenses --sdk_root="$SdkMappa" | Out-Null

Write-Host '  Platform és fordítóeszközök telepítése (kb. 120 MB)...' -ForegroundColor DarkGray
& $SdkManager --sdk_root="$SdkMappa" "platform-tools" "platforms;android-34" "build-tools;34.0.0"
if ($LASTEXITCODE -ne 0) {
    throw "Az Android SDK csomagok telepítése nem sikerult (kod: $LASTEXITCODE)."
}


# ---------------------------------------------------------------------
# 3. Fordítás
# ---------------------------------------------------------------------
Cim 'APK fordítása'

Push-Location $AndroidGyoker
try {
    & (Join-Path $AndroidGyoker 'gradlew.bat') --no-daemon assembleDebug
    if ($LASTEXITCODE -ne 0) {
        throw "A fordítás nem sikerült (kód: $LASTEXITCODE)."
    }
} finally {
    Pop-Location
}


# ---------------------------------------------------------------------
# 4. Eredmény
# ---------------------------------------------------------------------
$apk = Get-ChildItem (Join-Path $AndroidGyoker 'app\build\outputs\apk\debug') -Filter '*.apk' |
       Select-Object -First 1

Cim 'Kész'
if ($apk) {
    $meret = [math]::Round($apk.Length / 1MB, 1)
    Write-Host "  APK:  $($apk.FullName)" -ForegroundColor Green
    Write-Host "  Méret: $meret MB" -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  Másold át a telefonra, és nyisd meg a fájlkezelőből.'
    Write-Host '  Elso alkalommal engedélyezned kell az ismeretlen forrásból'
    Write-Host '  származó alkalmazások telepítését.'
} else {
    Write-Host '  Nem találom a kész APK-t. Nézd át a fenti kimenetet.' -ForegroundColor Yellow
}
Write-Host ''
