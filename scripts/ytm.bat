@echo off
setlocal enabledelayedexpansion

:: Dossiers du projet
if defined YTM_PROJECT_ROOT (
    set "PROJECT_ROOT=%YTM_PROJECT_ROOT%"
) else (
    set "PROJECT_ROOT=%~dp0.."
)
set "BIN_DIR=%PROJECT_ROOT%\bin"

if defined YTM_TEMP_DIR (
    set "TEMP_DIR=%YTM_TEMP_DIR%"
) else (
    set "TEMP_DIR=%PROJECT_ROOT%\temp_downloads"
)

if not exist "%TEMP_DIR%" (
    mkdir "%TEMP_DIR%"
)

:: Priorité aux binaires intégrés dans bin/
if exist "%BIN_DIR%\yt-dlp.exe" (
    set "YT_DLP_CMD=%BIN_DIR%\yt-dlp.exe"
) else (
    set "YT_DLP_CMD=yt-dlp"
)

set "FFMPEG_ARG="
if exist "%BIN_DIR%\ffmpeg.exe" (
    set "FFMPEG_ARG=--ffmpeg-location %BIN_DIR%\ffmpeg.exe"
)

echo [SoundStash] Telechargement dans : %TEMP_DIR%

"%YT_DLP_CMD%" %FFMPEG_ARG% -x -f "ba/b" ^
  --ignore-errors ^
  --newline ^
  --audio-format aac ^
  --audio-quality 128K ^
  --embed-metadata ^
  --embed-thumbnail ^
  --write-thumbnail ^
  --convert-thumbnails jpg ^
  --parse-metadata "playlist_index:%%(track_number)s" ^
  --parse-metadata "%%(title)s:%%(artist)s - %%(title)s" ^
  --parse-metadata "%%(channel,uploader)s:%%(artist)s" ^
  --parse-metadata "%%(artist)s:%%(album_artist)s" ^
  --parse-metadata "%%(album|Extrait Video)s:%%(album)s" ^
  --parse-metadata "%%(release_date>%%Y,upload_date>%%Y,release_year)s:%%(date)s" ^
  --parse-metadata "%%(release_date>%%Y,upload_date>%%Y,release_year)s:%%(year)s" ^
  --parse-metadata "Source\ yt-dlp:%%(comment)s" ^
  --postprocessor-args "ffmpeg:-metadata comment= -metadata description= -metadata synopsis=" ^
  -o "%TEMP_DIR%/%%(album,playlist_title,title)s/%%(playlist_index)02d %%(title)s.%%(ext)s" ^
  %*
